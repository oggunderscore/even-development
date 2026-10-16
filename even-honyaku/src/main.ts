import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MAX_TURN_MS } from './config'
import { Display, type UiState } from './display'
import { classifyInput } from './input'
import { toBytes } from './pcm'
import type { ServerMsg, Translation } from './protocol'
import { Session } from './session'
import { type Settings, hasKeys, loadSettings, loadSettingsFromBridge, normalizeSettings, saveSettings, setupSteps, toUserConfig } from './settings'
import { type Phase, PhoneUi } from './ui'
import './romaji-browser'

// Listening starts PAUSED. Once the user resumes it, the glasses mic streams continuously until they pause again:
//   listening  – always-on; server detects English / Japanese per utterance (JP → English, EN → romaji)
//   talking    – the wearer is holding the button (or tapped the glasses): English only → romaji
//   processing – just released; ambient listening is already running again, UI waits for `done`
//   paused     – user toggled listening off (swipe / phone button): mic closed, nothing streamed or billed;
//                hold-to-talk still works and returns here afterwards
//   idle       – not capturing (offline, no Even bridge, or startup)
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
type GlassesDisplay = Pick<Display, 'setState' | 'setLive' | 'addTranslation' | 'note' | 'scroll' | 'setSetup'>

// The phone UI + engine are set up BEFORE we wait for the Even bridge, so they work (and the
// typed-text form doesn't fall back to a native page-reloading submit) even when the bridge is
// missing, e.g. when the page is opened in a plain browser instead of the Even app / simulator.
const noDisplay: GlassesDisplay = { setState() {}, setLive() {}, addTranslation() {}, note() {}, scroll() {}, setSetup() {} }
let bridge: Bridge | null = null
let display: GlassesDisplay = noDisplay

// The user's own API keys. Loaded synchronously from localStorage for first paint, then reconciled with the
// bridge's store once it's up (see initGlasses).
let settings: Settings = loadSettings()


// Listening is OFF until the wearer turns it on (tap on the glasses / button on the phone).
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

const ui = new PhoneUi({
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
  onSave: (next, opts) => void applySettings(next, opts.test),
}, settings)

const session = new Session({
  onConnection(ok) {
    connected = ok
    if (ok) void startAmbient()
    else void haltCapture()
    syncState()
  },
  onMessage: handleServerMessage,
  getConfig: () => toUserConfig(settings),
})
void session.connect()

const keysAvailable = (): boolean => hasKeys(settings)

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

/** Persist settings, restart the engine with them, and optionally run the key test. */
async function applySettings(raw: Settings, test: boolean) {
  const next = normalizeSettings(raw) // pasted only an OpenRouter key? use OpenRouter
  settings = next
  await saveSettings(settings, bridge)
  ui.setSettings(settings)
  refreshSetup()

  session.reset() // stops the engine; connect() below starts it again with the new keys
  await session.connect()
  if (!test) {
    if (hasKeys(settings)) {
      ui.addNote('Setup complete. Hold the glasses or tap RESUME LISTENING to start.')
      ui.showView('feed')
    }
    return
  }
  ui.showTesting()
  await session.test()
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

/** Long press on the glasses / phone button: stop or resume always-on listening. */
async function toggleListening() {
  if (phase === 'talking') return // don't yank the mic out from under a held button
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

/** Wearer starts talking English (phone hold button down, or glasses tap). */
async function startTalk() {
  if (phase === 'talking') return
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
      display.addTranslation(t)
      ui.addTranslation(t)
      break
    }
    case 'done':
      settle()
      break
    case 'error':
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
      ui.showResults(msg.results)
      break
    case 'config_ok':
    case 'ready':
      break
  }
}

// ── Glasses ──────────────────────────────────────────────────────────────────
// Glasses: hold (long press, SDK 0.0.14+ / Even App 2.2.9+) pauses / resumes always-on listening,
// swipe scrolls / hides the feed, double tap exits. Hold-to-talk-in-English lives on the phone button.

let unsubscribe: () => void = () => {}
let lastScrollAt = 0
let lastHoldAt = 0

async function initGlasses() {
  const found = await Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
  if (!found) {
    ui.addError('Even bridge not found. Open Honyaku from the Even app. Typed text still works; mic and glasses are off')
    return
  }
  const glasses = new Display(found)
  const initResult = await glasses.init()
  if (initResult !== 0) {
    ui.addError(`Glasses page failed to start (code ${initResult}); phone UI only`)
    return
  }
  bridge = found
  display = glasses
  // The bridge's store outlives the WebView's localStorage; prefer it (and re-seed it from localStorage).
  const stored = await loadSettingsFromBridge(found)
  if (JSON.stringify(stored) !== JSON.stringify(settings)) {
    settings = stored
    ui.setSettings(settings)
    session.reset() // restart the engine with the stored keys
    await session.connect()
    if (hasKeys(settings)) ui.showView('feed')
  }
  refreshSetup()
  unsubscribe = bridge.onEvenHubEvent(onGlassesEvent)
  syncState()
  void startAmbient() // no-op until the socket is up; onConnection(true) covers that case
}

function onGlassesEvent(event: Parameters<Parameters<Bridge['onEvenHubEvent']>[0]>[0]) {
  if (event.audioEvent) {
    const raw = event.audioEvent.audioPcm
    const pcm = toBytes(raw)
    if (pcm && phase !== 'idle' && phase !== 'paused') {
      micChunks++
      session.sendAudio(pcm)
    }
    return
  }

  const input = classifyInput(event)

  switch (input) {
    case 'double_click':
      void exit()
      break
    case 'exit':
      void haltCapture().then(unsubscribe)
      break
    case 'foreground':
      // Capture stops when the WebView is suspended; re-arm it.
      if (micOpen) void bridge?.audioControl(true)
      break
    case 'scroll_older':
    case 'scroll_newer': {
      const now = Date.now()
      if (now - lastScrollAt > 300) {
        lastScrollAt = now
        display.scroll(input === 'scroll_older' ? 'older' : 'newer')
      }
      break
    }
    case 'long_press': {
      // Fires once when the hold registers; the release event is ignored. Debounced against repeats.
      const now = Date.now()
      if (now - lastHoldAt > 800) {
        lastHoldAt = now
        void toggleListening()
      }
      break
    }
    default:
      break // single taps are deliberately ignored so a stray touch can't open the mic
  }
}

async function exit() {
  await haltCapture()
  unsubscribe()
  await bridge?.shutDownPageContainer(1) // mode 1 = system exit dialog (required on the root page)
}

syncState()
refreshSetup()
if (!hasKeys(settings)) ui.showView('settings') // first run: straight to setup
void initGlasses().catch(() => ui.addError('Could not start the glasses display. Phone UI only'))
