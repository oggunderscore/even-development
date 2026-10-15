import { OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MAX_TURN_MS } from './config'
import { Display, type UiState } from './display'
import { toBytes } from './pcm'
import type { Direction, ServerMsg, Translation } from './protocol'
import { Session } from './session'
import { PhoneUi } from './ui'

type Phase = 'idle' | 'listening' | 'processing'

const bridge = await waitForEvenAppBridge()
const display = new Display(bridge)
const initResult = await display.init()
if (initResult !== 0) throw new Error(`createStartUpPageContainer failed: ${initResult}`)

let dir: Direction = 'speak'
let phase: Phase = 'idle'
let connected = false
/** Bumped per turn so a late startTurn()/timer from an abandoned turn can't touch the current one. */
let turn = 0
let maxTimer: ReturnType<typeof setTimeout> | undefined
let doneTimer: ReturnType<typeof setTimeout> | undefined

const ui = new PhoneUi({
  onHoldStart: () => void startListening(),
  onHoldEnd: () => void stopListening(),
  onMode: (d) => setDir(d),
  onTyped: (text) => {
    ui.markWorking()
    void session.translateText(dir, text).catch(() => ui.addError('Server unreachable'))
  },
})

const session = new Session({
  onConnection(ok) {
    connected = ok
    ui.setConnected(ok)
    if (!ok && phase !== 'idle') void abortTurn()
    syncState()
  },
  onMessage: handleServerMessage,
})
void session.connect().catch(() => {})

function syncState() {
  const s: UiState = !connected ? 'offline' : phase
  display.setState(s)
  ui.setPhase(phase)
}

function setDir(next: Direction) {
  if (phase !== 'idle') return // don't flip direction mid-turn
  dir = next
  display.setMode(dir)
  ui.setMode(dir)
}

async function startListening() {
  if (phase !== 'idle') return
  const mine = ++turn
  phase = 'listening'
  syncState()
  try {
    await session.startTurn(dir)
    if (mine !== turn || phase !== 'listening') return // released before the socket was ready
    await bridge.audioControl(true)
    maxTimer = setTimeout(() => void stopListening(), MAX_TURN_MS)
  } catch {
    if (mine === turn) await abortTurn('Server unreachable')
  }
}

async function stopListening() {
  if (phase !== 'listening') return
  clearTimeout(maxTimer)
  phase = 'processing'
  syncState()
  await bridge.audioControl(false)
  session.endTurn()
  // If the server never answers, don't leave the UI stuck.
  const mine = turn
  doneTimer = setTimeout(() => {
    if (mine === turn && phase === 'processing') finishTurn()
  }, 20_000)
}

async function abortTurn(reason?: string) {
  turn++
  clearTimeout(maxTimer)
  clearTimeout(doneTimer)
  phase = 'idle'
  await bridge.audioControl(false).catch(() => {})
  if (reason) {
    display.note(reason)
    ui.addError(reason)
  }
  syncState()
}

function finishTurn() {
  clearTimeout(doneTimer)
  phase = 'idle'
  display.setLive('')
  syncState()
}

function handleServerMessage(msg: ServerMsg) {
  switch (msg.type) {
    case 'partial':
      display.setLive(msg.text)
      ui.setLive(msg.dir, msg.text)
      break
    case 'final': {
      const t: Translation = msg
      display.addTranslation(t)
      ui.addTranslation(t)
      break
    }
    case 'done':
      finishTurn()
      break
    case 'error':
      display.note(msg.message.slice(0, 80))
      ui.addError(msg.message)
      if (phase !== 'idle') finishTurn()
      break
    case 'ready':
      break
  }
}

// ── Glasses input ────────────────────────────────────────────────────────────
// The SDK exposes tap / double-tap / swipe only — there is no press-and-hold gesture on the G2.
// So on the glasses a tap toggles the mic; the true hold-to-talk control is the phone button.
let lastScrollAt = 0

const unsubscribe = bridge.onEvenHubEvent((event) => {
  if (event.audioEvent) {
    const pcm = toBytes(event.audioEvent.audioPcm)
    if (pcm && phase === 'listening') session.sendAudio(pcm)
    return
  }

  const sysType = event.sysEvent?.eventType ?? -1
  const textType = event.textEvent?.eventType ?? OsEventTypeList.CLICK_EVENT // protobuf omits 0

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void exit()
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    void abortTurn().then(unsubscribe)
    return
  }
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    // Capture stops when the WebView is suspended; re-arm if we were mid-turn.
    if (phase === 'listening') void bridge.audioControl(true)
    return
  }

  if (event.textEvent === undefined) return

  if (textType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    const now = Date.now()
    if (now - lastScrollAt > 300) {
      lastScrollAt = now
      setDir(dir === 'speak' ? 'listen' : 'speak')
    }
    return
  }

  if (textType === OsEventTypeList.CLICK_EVENT) {
    if (phase === 'idle') void startListening()
    else if (phase === 'listening') void stopListening()
  }
})

async function exit() {
  await abortTurn()
  unsubscribe()
  await bridge.shutDownPageContainer(1) // mode 1 = system exit dialog (required on the root page)
}

ui.setMode(dir)
syncState()
