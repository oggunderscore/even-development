import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MAX_TURN_MS } from './config'
import { analyze } from './core/voice'
import { Segmenter } from './core/vad'
import { Display, type UiState } from './display'
import { Enrollment, REASON_TEXT } from './enroll'
import { createGlassesEventHandler } from './glasses-events'
import { type MenuState, itemForId, menuItems, menuPick } from './menu'
import { toBytes } from './pcm'
import { summarize } from './core/probes'
import type { ServerMsg, TestScope, Translation, VoiceProfile } from './protocol'
import { Session } from './session'
import { type Settings, hasKeys, loadSettings, loadSettingsFromBridge, providerKey, saveSettings, setupSteps, toUserConfig } from './settings'
import { planChange } from './settings-change'
import { type Phase, PhoneUi } from './ui'
import { loadVoice, loadVoiceFromBridge, saveVoice } from './voice-store'
import './romaji-browser'

// Listening starts PAUSED. Once the user resumes it, the glasses mic streams continuously until they pause again:
//   listening  – always-on; the engine detects English / Japanese per utterance (JP → English, EN → romaji), keeps the
//                wearer's own voice out of the conversation, and (Predictive mode) suggests replies
//   talking    – the wearer is holding the phone button: English only → romaji
//   processing – just released; ambient listening is already running again, UI waits for `done`
//   paused     – user toggled listening off (glasses menu / phone button): mic closed, nothing streamed or billed;
//                hold-to-talk still works and returns here afterwards
//   idle       – not capturing (offline, no Even bridge, or startup)
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
type GlassesDisplay = Pick<
  Display,
  'setState' | 'setLive' | 'addTranslation' | 'note' | 'scroll' | 'setSetup' | 'predictions' | 'predictionFailed' | 'self' | 'setMode' | 'setKana' | 'configure'
>

// The phone UI + engine are set up BEFORE we wait for the Even bridge, so they work (and the
// typed-text form doesn't fall back to a native page-reloading submit) even when the bridge is
// missing, e.g. when the page is opened in a plain browser instead of the Even app / simulator.
const noDisplay: GlassesDisplay = {
  setState() {},
  setLive() {},
  addTranslation() {},
  note() {},
  scroll() {},
  setSetup() {},
  predictions() {},
  predictionFailed() {},
  self() {},
  setMode: () => Promise.resolve(),
  setKana() {},
  configure: () => Promise.resolve(),
}
let bridge: Bridge | null = null
let display: GlassesDisplay = noDisplay

// The user's own API keys and choices, and the wearer's voiceprint. Loaded synchronously from localStorage for first
// paint, then reconciled with the bridge's store once it's up (see initGlasses).
let settings: Settings = loadSettings()
let voiceProfile: VoiceProfile | null = loadVoice()
/** The engine confirmed it can suggest replies (Predictive mode is on and an LLM key is set). */
let predictReady = false

// Listening is OFF until the wearer turns it on (glasses menu / button on the phone).
let phase: Phase = 'paused'
/** User intent: always-on listening is switched off. Survives reconnects. */
let paused = true
let connected = false
let micOpen = false
/** Bumped on every phase change that invalidates in-flight async work (late timers, abandoned starts). */
let turn = 0
let maxTimer: ReturnType<typeof setTimeout> | undefined
let doneTimer: ReturnType<typeof setTimeout> | undefined
let micWatchdog: ReturnType<typeof setTimeout> | undefined
/** Mic chunks received since the mic was opened; zero a few seconds in means the mic isn't delivering. */
let micChunks = 0
/** The voice setup (enrollment or live test) currently borrowing the glasses mic; declared up here because the capture helpers read it. */
let lab: { kind: 'enroll' | 'test'; seg: Segmenter; enrollment?: Enrollment; resume: boolean } | null = null

const ui = new PhoneUi(
  {
    onHoldStart: () => void startTalk(),
    onHoldEnd: () => void stopTalk(),
    onToggleListen: () => void toggleListening(),
    onTyped: (text) => {
      if (!keysAvailable()) return needKeys()
      ui.markWorking()
      void session.translateText(text).catch(() => {
        ui.setLive('speak', '')
        ui.addError('Translation engine not running')
      })
    },
    onChange: (next) => void queueSettingsChange(next),
    onEditing: (scope) => {
      checkId[scope]++ // an answer about the old text must not land under the new
      checkOk[scope] = false
      editing[scope] = true
      ui.setKeyStatus(scope, 'idle')
    },
    onPrefs: (patch) => void updateSettings(patch),
    onEnroll: () => void startLab('enroll'),
    onEnrollSkip: () => skipEnroll(),
    onLabStop: () => void stopLab(),
    onVoiceTest: () => void startLab('test'),
    onVoiceDelete: () => void deleteVoice(),
  },
  settings,
)
ui.setVoiceProfile(voiceProfile)

const session = new Session({
  onConnection(ok) {
    connected = ok
    if (ok) void startAmbient()
    else void haltCapture()
    syncState()
  },
  onMessage: handleServerMessage,
  getConfig: () => toUserConfig(settings, voiceProfile),
})
void session.connect()

const keysAvailable = (): boolean => hasKeys(settings)
/** Predictive mode needs a provider that can write text; Google Translate cannot. */
const hasLlm = (s: Settings = settings): boolean => s.provider !== 'google' && providerKey(s) !== ''
const predictive = (): boolean => settings.mode === 'predictive' && predictReady

/** What first-run setup is still missing, in words for the glasses. Null once both keys are in. */
function missingSetup(): string[] | null {
  const names = { deepgram: 'Deepgram key', translate: 'Google, OpenRouter or Claude key' }
  const missing = setupSteps(settings).filter((s) => !s.done).map((s) => names[s.id])
  return missing.length ? missing : null
}

/** Phone banner + glasses screen that say "finish setup" while a key is missing. */
function refreshSetup() {
  const missing = missingSetup()
  ui.setNeedsKeys(missing !== null)
  display.setSetup(missing)
}

/** A key is missing: stop listening and point the user at Settings (phone) and at the phone (glasses). */
function needKeys(message = 'Add your Deepgram and translation keys in Settings to start') {
  refreshSetup()
  ui.addError(message)
  ui.showView('settings')
  if (!paused) void toggleListening()
}

/** The id of the newest key check per field; an answer to an older one (typed over since) is ignored. */
const checkId: Record<TestScope, number> = { stt: 0, translate: 0 }
const checkOk: Record<TestScope, boolean> = { stt: false, translate: false }
/** A key field was edited since its last commit, so its check should run again even if the value ended up the same. */
const editing: Record<TestScope, boolean> = { stt: false, translate: false }
/** First launch without keys: once both check out, take the user to the feed (once). Recomputed after the bridge settings load. */
let onboarding = !hasKeys(settings)

function runCheck(scope: TestScope) {
  const id = ++checkId[scope]
  checkOk[scope] = false
  ui.setKeyStatus(scope, 'checking', scope === 'stt' ? 'Checking the key…' : 'Checking the key and the model…')
  void session.test(scope, id).catch(() => ui.setKeyStatus(scope, 'bad', 'Could not run the check.'))
}

/**
 * The settings form saves itself: a key a moment after typing stops, a provider or model at once. Save it, give the
 * engine the new values, and check whatever changed so a wrong key is called out right where it was entered.
 */
let settingsQueue: Promise<void> = Promise.resolve()

/** Commits run one at a time: two quick edits must not interleave their engine restarts and checks. */
function queueSettingsChange(raw: Settings): Promise<void> {
  settingsQueue = settingsQueue.then(() => onSettingsChange(raw)).catch(() => {})
  return settingsQueue
}

async function onSettingsChange(raw: Settings) {
  const plan = planChange(settings, raw)
  // An edited field that ended up unchanged (typed then reverted) still lost its status: check it again.
  const recheck = (['stt', 'translate'] as const).filter((s) => editing[s] && !plan.test.includes(s) && !plan.clear.includes(s) && hasKeyFor(s, plan.changed ? plan.next : settings))
  editing.stt = editing.translate = false
  if (!plan.changed) {
    for (const scope of recheck) runCheck(scope)
    return
  }
  settings = plan.next
  await saveSettings(settings, bridge)
  if (plan.switchedProvider) ui.showProvider(settings.provider)
  refreshSetup()
  void syncGlassesPrefs()

  if (plan.restartStream) {
    session.reset() // the open stream holds the old key; connect() below reopens it (if listening) with the new one
    await session.connect()
  } else {
    session.reconfigure()
  }
  for (const scope of plan.clear) {
    checkId[scope]++
    checkOk[scope] = false
    ui.setKeyStatus(scope, 'idle')
  }
  for (const scope of [...plan.test, ...recheck]) runCheck(scope)
}

const hasKeyFor = (scope: TestScope, s: Settings): boolean => (scope === 'stt' ? s.deepgramKey !== '' : providerKey(s) !== '')

/** A key check came back. */
function onCheckResult(msg: Extract<ServerMsg, { type: 'test_result' }>) {
  if (msg.id !== checkId[msg.scope]) return
  const s = summarize(msg.results)
  checkOk[msg.scope] = s.ok
  ui.setKeyStatus(msg.scope, s.ok ? 'ok' : 'bad', s.text)
  if (!onboarding || !s.ok) return
  // The other key may have been stored before (so it was never checked this session): check it so the first run can finish.
  const other: TestScope = msg.scope === 'stt' ? 'translate' : 'stt'
  if (!checkOk[other] && checkId[other] === 0 && hasKeyFor(other, settings)) runCheck(other)
  if (checkOk.stt && checkOk.translate) {
    onboarding = false
    // Only move the user along if they are still in Settings (not reading the feed or editing something else).
    setTimeout(() => {
      if (ui.currentView === 'settings') ui.showView('feed')
    }, 1500) // long enough to see both ticks
  }
}

/** A preference changed (phone control or glasses menu): save it, tell the engine and the glasses, keep streams running. */
async function updateSettings(patch: Partial<Settings>) {
  if (patch.mode === 'predictive' && !hasLlm()) {
    ui.addNote('Predictive mode needs an OpenRouter or Claude key (Google Translate cannot suggest replies).')
    patch = { ...patch, mode: 'standard' }
  }
  settings = { ...settings, ...patch }
  ui.setPrefs(settings) // not setSettings: that would overwrite key fields the user is still typing
  await saveSettings(settings, bridge)
  session.reconfigure()
  await syncGlassesPrefs()
}

async function syncGlassesPrefs() {
  display.setKana(settings.glassesKana)
  // Mode and the contextual-menu labels (which show the settings' values) change together, in one page rebuild.
  await display.configure({ mode: settings.mode, menu: menuItems(menuState()) })
}

function syncState() {
  const s: UiState = !connected ? 'offline' : phase === 'paused' || phase === 'idle' ? 'idle' : phase
  display.setState(s)
  ui.setStatus(connected, phase)
}

// ── Capture lifecycle ────────────────────────────────────────────────────────

async function openMic() {
  if (micOpen || !bridge) return
  micChunks = 0
  const ok = await bridge.audioControl(true)
  if (!ok) {
    ui.addError('Mic did not open. Check the microphone permission and that the glasses are connected')
    return
  }
  micOpen = true
  clearTimeout(micWatchdog)
  micWatchdog = setTimeout(() => {
    if (micOpen && micChunks === 0) {
      ui.addError('No audio from the mic yet')
    }
  }, 3000)
}

async function closeMic() {
  clearTimeout(micWatchdog)
  if (!micOpen) return
  micOpen = false
  await bridge?.audioControl(false).catch(() => {})
}

/** Connected → start the always-on stream and open the mic. */
async function startAmbient() {
  if (phase !== 'idle' || paused || !bridge || !connected) return
  const mine = ++turn
  phase = 'listening'
  syncState()
  try {
    await session.startStream('auto')
    if (mine !== turn) return
    await openMic()
  } catch {
    /* connection loss is handled by onConnection */
  }
}

/** Connection lost: stop everything; startAmbient() re-arms it when the socket comes back. */
async function haltCapture() {
  turn++
  clearTimeout(maxTimer)
  clearTimeout(doneTimer)
  clearTimeout(micWatchdog)
  phase = paused ? 'paused' : 'idle'
  syncState()
  await closeMic()
}

/**
 * Re-arm always-on capture after anything that can silently kill it: the WebView being suspended (the mic stops and
 * the Deepgram sockets drop), a BLE hiccup, or a stream that gave up reconnecting. Keeps the user's pause choice.
 */
async function resumeCapture() {
  if (!bridge || paused || !connected || phase === 'talking' || lab) return
  turn++
  clearTimeout(doneTimer)
  clearTimeout(micWatchdog)
  micOpen = false // force audioControl(true) again; the old capture may be gone
  phase = 'idle'
  await startAmbient()
}

/** Glasses menu / phone button: stop or resume always-on listening. */
async function toggleListening() {
  if (phase === 'talking' || lab) return // don't yank the mic out from under a held button or the voice setup
  if (paused) {
    if (!keysAvailable()) return needKeys()
    paused = false
    if (phase === 'paused') phase = 'idle'
    if (phase === 'processing') void session.startStream('auto').then(openMic).catch(() => {}) // mid-flush: just re-arm
    else void startAmbient()
    syncState()
    return
  }
  paused = true
  turn++
  clearTimeout(doneTimer)
  phase = 'paused'
  syncState()
  if (connected) session.endStream() // flush the last phrase; `done` just refreshes the UI
  await closeMic()
}

/** Wearer starts talking English (phone hold button down). */
async function startTalk() {
  if (phase === 'talking' || lab) return
  if (!bridge) {
    ui.addError('No glasses mic — Even bridge not connected')
    return
  }
  if (!keysAvailable()) return needKeys()
  const mine = ++turn
  clearTimeout(doneTimer)
  phase = 'talking'
  syncState()
  try {
    await session.startStream('talk')
    if (mine !== turn) return
    await openMic()
    clearTimeout(maxTimer)
    maxTimer = setTimeout(() => void stopTalk(), MAX_TURN_MS)
  } catch {
    /* connection loss is handled by onConnection */
  }
}

/** Wearer is done: flush English → romaji, and drop straight back to always-on listening. */
async function stopTalk() {
  if (phase !== 'talking') return
  clearTimeout(maxTimer)
  const mine = ++turn
  phase = 'processing'
  syncState()
  session.endStream()
  if (paused) {
    await closeMic() // the talk stream was already flushed by `end`; nothing more to capture
  } else {
    try {
      await session.startStream('auto') // resumes ambient immediately; `done` for the talk stream still arrives
    } catch {
      /* connection loss is handled by onConnection */
    }
  }
  // If translation never finishes, don't leave the UI stuck on "translating".
  doneTimer = setTimeout(() => {
    if (mine === turn && phase === 'processing') {
      ui.addError('Translation timed out after 20s')
      settle()
    }
  }, 20_000)
}

/** Back to plain always-on listening. */
function settle() {
  clearTimeout(doneTimer)
  if (phase === 'processing') phase = paused ? 'paused' : 'listening'
  display.setLive('')
  syncState()
}

function handleServerMessage(msg: ServerMsg) {
  switch (msg.type) {
    case 'partial':
      display.setLive(msg.text, msg.dir)
      ui.setLive(msg.dir, msg.text)
      break
    case 'final': {
      const t: Translation = msg
      display.addTranslation(t, predictive() && t.dir === 'listen' && !t.unsure)
      ui.addTranslation(t)
      break
    }
    case 'predictions':
      display.predictions(msg.turnId, msg.prediction)
      ui.addPredictions(msg.prediction)
      break
    case 'self':
      display.self(msg.optionIndex, msg.turnId)
      display.setLive('')
      ui.addSelf(msg.text, msg.option)
      break
    case 'voice_score':
      ui.showVoiceScore(msg)
      break
    case 'voice_profile':
      voiceProfile = msg.profile
      ui.setVoiceProfile(voiceProfile)
      void saveVoice(voiceProfile, bridge)
      break
    case 'done':
      settle()
      break
    case 'error':
      if (msg.code === 'no_llm') {
        // Predictive was asked for but the provider can't do it: fall back to the classic screen and say why.
        ui.addError(msg.message)
        if (settings.mode === 'predictive') void updateSettings({ mode: 'standard' })
        break
      }
      if (msg.message.startsWith('reply suggestions:')) {
        display.predictionFailed(msg.message.replace('reply suggestions: ', ''))
        ui.addError(msg.message)
        break
      }
      display.note(msg.message.slice(0, 80))
      ui.setLive('speak', '')
      if (msg.code === 'no_keys') {
        needKeys(msg.message)
        if (phase === 'processing') settle()
        break
      }
      ui.addError(msg.message)
      if (phase === 'processing') settle()
      break
    case 'test_result':
      onCheckResult(msg)
      break
    case 'config_ok':
      predictReady = msg.predict
      break
    case 'ready':
      break
  }
}

// ── Voice setup: enrollment and live test ────────────────────────────────────
// Both borrow the glasses mic while normal listening is paused, and work entirely on the phone (nothing is sent to
// Deepgram or anywhere else). Enrollment turns a few read-aloud sentences into the wearer's voiceprint; the test shows,
// for each thing said, exactly what the voice filter would decide — the tool for tuning it.

let labStarting = false

async function startLab(kind: 'enroll' | 'test') {
  if (lab || labStarting) return
  if (!bridge) {
    ui.addError('The glasses mic is needed for voice setup. Open Honyaku from the Even app with the glasses connected')
    return
  }
  if (phase === 'talking') return
  labStarting = true // a second tap while we pause listening must not start a second session
  const resume = !paused
  try {
    if (resume) await toggleListening() // pauses and closes the mic
  } finally {
    labStarting = false
  }
  const enrollment = kind === 'enroll' ? new Enrollment() : undefined
  const seg = new Segmenter(
    (audio) => onLabSegment(audio),
    (db, speaking) => ui.setLabLevel(db, speaking),
  )
  lab = { kind, seg, enrollment, resume }
  ui.setLabState(kind)
  if (enrollment) ui.setEnrollStep(enrollment.current, enrollment.index, enrollment.total)
  await openMic()
  if (!micOpen) await stopLab()
}

function onLabSegment(audio: Float32Array) {
  if (!lab) return
  if (lab.enrollment) {
    const e = lab.enrollment
    const r = e.submit(audio)
    if (!r.ok) {
      ui.setLabMessage(REASON_TEXT[r.reason], 'warn')
      return
    }
    ui.setLabMessage('Got it.', 'ok')
    if (e.done) return void finishEnroll()
    ui.setEnrollStep(e.current, e.index, e.total)
    return
  }
  // live test: the same analysis the engine runs on every utterance (minus the echo signal)
  const a = analyze(voiceProfile, audio, settings.voiceStrictness)
  ui.setTestResult(a.who, a.voice, a.level, voiceProfile !== null)
}

function skipEnroll() {
  const e = lab?.enrollment
  if (!e) return
  e.skip()
  if (e.done) return void finishEnroll()
  ui.setEnrollStep(e.current, e.index, e.total)
}

async function finishEnroll() {
  const e = lab?.enrollment
  if (!e) return
  const { profile, ready, quality } = e.result()
  if (!ready) {
    ui.setLabMessage('Not enough good samples: at least 2 English and 2 Japanese sentences are needed. Try again, in a quieter place if you can.', 'warn')
    await stopLab()
    return
  }
  // A fresh enrollment replaces the old voiceprint, including what it had learned.
  voiceProfile = profile
  await saveVoice(voiceProfile, bridge)
  ui.setVoiceProfile(voiceProfile)
  session.reconfigure()
  ui.setLabMessage(`Voice profile saved (${quality.label}). Try the live test to check it.`, 'ok')
  await stopLab()
}

let labStopping = false

async function stopLab() {
  const current = lab
  if (!current || labStopping) return
  labStopping = true // a segment closed by the flush below may finish enrollment, which calls stopLab again
  current.seg.flush() // an utterance still in progress is analysed, not thrown away
  lab = null
  labStopping = false
  ui.setLabState('idle')
  await closeMic()
  if (current.resume) await toggleListening()
}

async function deleteVoice() {
  voiceProfile = null
  await saveVoice(null, bridge)
  ui.setVoiceProfile(null)
  session.reconfigure()
  ui.addNote('Voice profile deleted.')
}

// ── Glasses ──────────────────────────────────────────────────────────────────
// Glasses: a single tap pauses / resumes listening; a double tap on the home page opens the system exit dialog
// (required by the store); the OS contextual menu (tap then long press) carries Pause / Resume and the settings; swipe
// scrolls the feed (or moves the highlight in Predictive mode). Plain hold (long press) is left alone — users commonly
// bind it to their own action. Hold-to-talk-in-English lives on the phone button.

// The event subscription is created once and never removed: the app must keep reacting to the glasses for as long
// as it is alive, including after the exit dialog was answered "No" or the phone has been in the background.
/** The Even bridge as soon as the app has it: double tap must work even if the rest of start-up is slow or fails. */
let eventBridge: Bridge | null = null

const menuState = (s: Settings = settings): MenuState => ({
  hasLlm: hasLlm(s),
  settings: { mode: s.mode, replyStyle: s.replyStyle, maxOptions: s.maxOptions, voiceFilter: s.voiceFilter, glassesKana: s.glassesKana },
})

/** The wearer picked one of our items in the OS contextual menu. */
async function onMenuPick(itemID: number) {
  const item = itemForId(menuItems(menuState()), itemID)
  const action = item ? menuPick(menuState(), item.id) : null
  if (!action) return
  switch (action.type) {
    case 'toggle_listen':
      await toggleListening()
      break
    case 'set':
      await updateSettings(action.patch) // also re-declares the menu so its labels show the new values
      break
    case 'note':
      display.note(action.text)
      break
  }
}

async function initGlasses() {
  const found = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
  if (!found) {
    ui.addError('Even bridge not found. Open Honyaku from the Even app. Typed text still works; mic and glasses are off')
    return
  }
  // Listen to the glasses right away, before the storage reads, page creation and engine start below. Those can be slow or
  // fail, and a double tap (the exit) must reach shutDownPageContainer(1) regardless. The subscription is never removed.
  eventBridge = found
  found.onEvenHubEvent(onGlassesEvent)

  // The bridge's store outlives the WebView's localStorage; prefer it (and re-seed it from localStorage).
  const stored = await loadSettingsFromBridge(found)
  const storedVoice = await loadVoiceFromBridge(found)
  const glasses = new Display(found, { mode: stored.mode, kana: stored.glassesKana, menu: menuItems(menuState(stored)) })
  const initResult = await glasses.init()
  if (initResult !== 0) {
    ui.addError(`Glasses page failed to start (code ${initResult}); phone UI only`)
    return
  }
  bridge = found
  display = glasses
  voiceProfile = storedVoice ?? voiceProfile
  ui.setVoiceProfile(voiceProfile)
  if (JSON.stringify(stored) !== JSON.stringify(settings)) {
    settings = stored
    ui.setSettings(settings)
  }
  onboarding = !hasKeys(settings) // the bridge store may hold keys the WebView's localStorage doesn't
  session.reset() // restart the engine with the stored keys, preferences and voiceprint
  await session.connect()
  if (hasKeys(settings)) ui.showView('feed')
  refreshSetup()
  watchLiveness()
  syncState()
  void startAmbient() // no-op until the socket is up; onConnection(true) covers that case
}

/** Gestures and menu picks (see glasses-events.ts, where the double tap → shutDownPageContainer(1) wiring is tested). */
const handleGlassesInput = createGlassesEventHandler({
  bridge: () => eventBridge,
  toggleListening: () => void toggleListening(),
  scroll: (direction) => display.scroll(direction),
  menuPick: (itemID) => void onMenuPick(itemID),
  resumeCapture: () => void resumeCapture(),
  haltCapture: () => void haltCapture(),
  note: (text) => display.note(text),
})

function onGlassesEvent(event: Parameters<Parameters<Bridge['onEvenHubEvent']>[0]>[0]) {
  if (event.audioEvent) {
    const pcm = toBytes(event.audioEvent.audioPcm)
    if (pcm && lab) {
      micChunks++
      lab.seg.push(pcm)
    } else if (pcm && phase !== 'idle' && phase !== 'paused') {
      micChunks++
      session.sendAudio(pcm)
    }
    return
  }
  handleGlassesInput(event)
}

/**
 * Timers are throttled or frozen while the phone is locked / the Even app is backgrounded, and the OS tells us only
 * sometimes. A wall-clock gap between ticks (or the page becoming visible again) means we were frozen: re-arm.
 */
function watchLiveness() {
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const frozen = now - last > 20_000
    last = now
    if (frozen) void resumeCapture()
  }, 5000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resumeCapture()
  })
}

syncState()
refreshSetup()
if (!hasKeys(settings)) ui.showView('settings') // first run: straight to setup
void initGlasses().catch(() => ui.addError('Could not start the glasses display. Phone UI only'))
