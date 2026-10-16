import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MAX_TURN_MS, describeConfig } from './config'
import { setLogSink } from './core/log'
import { dbg } from './debug'
import { Display, type UiState } from './display'
import { classifyInput } from './input'
import { toBytes } from './pcm'
import type { ServerMsg, Translation } from './protocol'
import { Session } from './session'
import { type Settings, hasKeys, loadSettings, loadSettingsFromBridge, providerKey, saveSettings, toUserConfig, withoutKeys } from './settings'
import { type Phase, PhoneUi } from './ui'
import './romaji-browser'

// The shared engine logs through the debug panel (it never receives a key or token).
setLogSink(
  (tag, ...a) => dbg(`[${tag}] ${a.join(' ')}`),
  (tag, ...a) => dbg(`[${tag}] ⚠ ${a.join(' ')}`),
)

// Listening starts PAUSED. Once the user resumes it, the glasses mic streams continuously until they pause again:
//   listening  – always-on; server detects English / Japanese per utterance (JP → English, EN → romaji)
//   talking    – the wearer is holding the button (or tapped the glasses): English only → romaji
//   processing – just released; ambient listening is already running again, UI waits for `done`
//   paused     – user toggled listening off (swipe / phone button): mic closed, nothing streamed or billed;
//                hold-to-talk still works and returns here afterwards
//   idle       – not capturing (offline, no Even bridge, or startup)
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>
type GlassesDisplay = Pick<Display, 'setState' | 'setLive' | 'addTranslation' | 'note' | 'scroll'>

// The phone UI + server link are set up BEFORE we wait for the Even bridge, so they work (and the
// typed-text form doesn't fall back to a native page-reloading submit) even when the bridge is
// missing, e.g. when the page is opened in a plain browser instead of the Even app / simulator.
const noDisplay: GlassesDisplay = { setState() {}, setLive() {}, addTranslation() {}, note() {}, scroll() {} }
let bridge: Bridge | null = null
let display: GlassesDisplay = noDisplay

// The user's own server address + API keys. Loaded synchronously from localStorage for first paint, then
// reconciled with the bridge's store once it's up (see initGlasses).
let settings: Settings = loadSettings()
/** What the server told us after `config`: whether it can transcribe/translate with the keys it has. */
let serverCan: { stt: boolean; translate: boolean; serverKeys: boolean } | null = null

const describe = () => describeConfig(settings.mode, settings.serverUrl, settings.serverToken, { deepgram: !!settings.deepgramKey, translate: !!providerKey(settings) })
dbg(describe())

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
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
/** Mic chunks received since the mic was opened (debugging aid). */
let micChunks = 0
let micBytes = 0

const ui = new PhoneUi({
  onHoldStart: () => void startTalk(),
  onHoldEnd: () => void stopTalk(),
  onToggleListen: () => void toggleListening(),
  onTyped: (text) => {
    if (!keysAvailable()) return needKeys()
    ui.markWorking()
    dbg(`typed: "${text}"`)
    void session.translateText(text).catch(() => {
      ui.setLive('speak', '')
      ui.addError(session.lastError ?? 'Server unreachable')
    })
  },
  onSave: (next, opts) => void applySettings(next, opts.test),
  onClear: () => void applySettings(withoutKeys(ui.readSettings()), false, 'Keys cleared'),
}, settings)

const session = new Session({
  onConnection(ok) {
    dbg(`connection ${ok ? 'UP' : 'DOWN'}`)
    connected = ok
    if (ok) {
      clearTimeout(reconnectTimer)
      void startAmbient()
    } else {
      void haltCapture()
      scheduleReconnect()
    }
    syncState()
  },
  onMessage: handleServerMessage,
  getTarget: () => ({ mode: settings.mode, url: settings.serverUrl, config: toUserConfig(settings) }),
})
void session.connect().catch(() => {})

/** True when the app has its own keys, or the server reported it has fallback keys of its own. */
function keysAvailable(): boolean {
  return hasKeys(settings) || (serverCan?.serverKeys === true && serverCan.stt && serverCan.translate)
}

/** A key is missing: stop listening and point the user at Settings. */
function needKeys(message = 'Add your Deepgram and translation keys in Settings to start') {
  dbg(`needKeys: ${message}`)
  ui.setNeedsKeys(true)
  ui.addError(message)
  ui.showView('settings')
  if (!paused) void toggleListening()
}

/** Persist settings, reconnect so the server gets the new config, and optionally run the key test. */
async function applySettings(next: Settings, test: boolean, note?: string) {
  settings = next
  serverCan = null
  await saveSettings(settings, bridge)
  ui.setSettings(settings)
  ui.setNeedsKeys(!hasKeys(settings))
  dbg(`settings saved. ${describe()}`)
  if (note) ui.addNote(note)

  session.reset() // closes the socket; connect() below re-sends config with the new values
  if (!test) {
    void session.connect().catch(() => {})
    return
  }
  ui.showTesting()
  try {
    await Promise.race([session.connect(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out after 8s')), 8000))])
    await session.test()
  } catch (err) {
    ui.showResults([{ service: 'server', ok: false, detail: session.lastError ?? (err instanceof Error ? err.message : 'unreachable') }])
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    dbg('reconnecting…')
    void session.connect().catch(() => {})
  }, 2000)
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
  micBytes = 0
  const ok = await bridge.audioControl(true)
  dbg(`audioControl(true) → ${ok}`)
  if (!ok) {
    dbg('mic did not open — is the g2-microphone permission granted and the glasses connected?')
    ui.addError('Mic did not open')
    return
  }
  micOpen = true
  clearTimeout(micWatchdog)
  micWatchdog = setTimeout(() => {
    if (micOpen && micChunks === 0) {
      dbg('NO audio events 3s after opening the mic — check mic permission / glasses connection / simulator audio input')
      ui.addError('No audio from the mic yet')
    }
  }, 3000)
}

async function closeMic() {
  clearTimeout(micWatchdog)
  if (!micOpen) return
  micOpen = false
  await bridge?.audioControl(false).catch(() => {})
  dbg('mic closed')
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
  } catch (err) {
    dbg(`startAmbient failed: ${err instanceof Error ? err.message : err}`)
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
    dbg('listening resumed')
    if (phase === 'paused') phase = 'idle'
    if (phase === 'processing') void session.startStream('auto').then(openMic).catch(() => {}) // mid-flush: just re-arm
    else void startAmbient()
    syncState()
    return
  }
  paused = true
  dbg('listening paused')
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
    dbg('talk ignored: no Even bridge, so no mic')
    ui.addError('No glasses mic — Even bridge not connected')
    return
  }
  if (!connected) {
    ui.addError(session.lastError ?? 'Server offline')
    return
  }
  if (!keysAvailable()) return needKeys()
  const mine = ++turn
  clearTimeout(doneTimer)
  phase = 'talking'
  dbg('startTalk')
  syncState()
  try {
    await session.startStream('talk')
    if (mine !== turn) return
    await openMic()
    clearTimeout(maxTimer)
    maxTimer = setTimeout(() => void stopTalk(), MAX_TURN_MS)
  } catch (err) {
    dbg(`startTalk failed: ${err instanceof Error ? err.message : err}`)
  }
}

/** Wearer is done: flush English → romaji, and drop straight back to always-on listening. */
async function stopTalk() {
  if (phase !== 'talking') return
  clearTimeout(maxTimer)
  const mine = ++turn
  phase = 'processing'
  dbg(`stopTalk: ${micChunks} mic chunks / ${micBytes} bytes so far`)
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
  // If the server never answers, don't leave the UI stuck on "translating".
  doneTimer = setTimeout(() => {
    if (mine === turn && phase === 'processing') {
      dbg('no "done" from server after 20s — giving up on this turn')
      ui.addError('Server did not answer in 20s')
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
    case 'config_ok':
      serverCan = { stt: msg.stt, translate: msg.translate, serverKeys: msg.serverKeys }
      ui.setNeedsKeys(!keysAvailable())
      break
    case 'test_result':
      ui.showResults(
        settings.mode === 'server' ? [{ service: 'server', ok: true, detail: 'connected · access token accepted' }, ...msg.results] : msg.results,
      )
      break
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
    const msg = 'Even bridge not found after 4s — open this page via the Even app or simulator. Typed text still works; mic and glasses are disabled.'
    dbg(msg)
    ui.addError(msg)
    return
  }
  dbg('bridge ready')
  const glasses = new Display(found)
  const initResult = await glasses.init()
  dbg(`glasses page init result: ${initResult} (0 = ok)`)
  if (initResult !== 0) {
    ui.addError(`Glasses page failed to start (code ${initResult}); phone UI only`)
    return
  }
  bridge = found
  display = glasses
  // The bridge's store outlives the WebView's localStorage; prefer it (and re-seed it from localStorage).
  const stored = await loadSettingsFromBridge(found)
  if (JSON.stringify(stored) !== JSON.stringify(settings)) {
    dbg('settings loaded from the Even bridge store')
    settings = stored
    ui.setSettings(settings)
    ui.setNeedsKeys(!hasKeys(settings))
    session.reset() // reconnect with the stored server address / keys
  }
  unsubscribe = bridge.onEvenHubEvent(onGlassesEvent)
  syncState()
  void startAmbient() // no-op until the socket is up; onConnection(true) covers that case
}

function onGlassesEvent(event: Parameters<Parameters<Bridge['onEvenHubEvent']>[0]>[0]) {
  if (event.audioEvent) {
    const raw = event.audioEvent.audioPcm
    const pcm = toBytes(raw)
    if (micChunks === 0) {
      const shape = Array.isArray(raw) ? 'number[]' : raw instanceof Uint8Array ? 'Uint8Array' : typeof raw
      dbg(`first audio event: ${shape}, ${pcm ? `${pcm.length} bytes` : 'UNRECOGNISED (dropped)'}, phase=${phase}`)
    }
    if (pcm && phase !== 'idle' && phase !== 'paused') {
      micChunks++
      micBytes += pcm.length
      session.sendAudio(pcm)
    }
    return
  }

  const input = classifyInput(event)
  dbg(`glasses event → ${input}  raw=${JSON.stringify(event).slice(0, 140)}`)

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
ui.setNeedsKeys(!hasKeys(settings))
void initGlasses().catch((err) => {
  const msg = `glasses init failed: ${err instanceof Error ? err.message : err}`
  dbg(msg)
  ui.addError(msg)
})
