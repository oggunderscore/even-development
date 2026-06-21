import { DeviceConnectType, OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Display } from './display'
import { BridgeSocket } from './socket'
import { VoiceRecorder } from './voice'
import { transcribe } from './stt'
import { parseCommand } from './parser'
import { stripAnsi } from './ansi'
import { makeLog } from './log'
import type { SttConfig } from './stt'
import type { StorageAdapter } from './socket'

const log = makeLog('main')

// ── Configuration ─────────────────────────────────────────────────────────────
// Set VITE_BRIDGE_HOSTNAME in .env.local — never edit this file for machine differences.
//   MacBook:  VITE_BRIDGE_HOSTNAME=kevins-macbook-pro
//   Windows:  VITE_BRIDGE_HOSTNAME=localhost
const BRIDGE_HOSTNAME = (import.meta.env['VITE_BRIDGE_HOSTNAME'] as string | undefined) ?? 'kevins-macbook-pro'
const BRIDGE_WS_PORT  = 8765

// STT: Option A — OpenAI Whisper (cloud)
const STT: SttConfig = {
  endpoint: 'https://api.openai.com/v1/audio/transcriptions',
  apiKey: 'sk-YOUR_KEY_HERE',
  model: 'whisper-1',
}

// STT: Option B — local whisper.cpp server on home AI machine
// const STT: SttConfig = { endpoint: 'http://192.168.1.50:8080/inference' }
// ──────────────────────────────────────────────────────────────────────────────

async function boot() {
  log.info(`booting  hostname=${BRIDGE_HOSTNAME}  port=${BRIDGE_WS_PORT}`)

  const bridge = await waitForEvenAppBridge()
  log.info('bridge ready')

  const display = new Display(bridge)
  const initResult = await display.init()
  if (initResult !== 0) {
    log.error(`display init failed (code ${initResult})`)
    return
  }
  log.info('display init OK')

  // Bridge local storage so BridgeSocket can persist the last-working IP
  const storage: StorageAdapter = {
    get:  (key)       => bridge.getLocalStorage(key),
    set:  (key, val)  => bridge.setLocalStorage(key, val),
  }

  const socket = new BridgeSocket(
    BRIDGE_HOSTNAME,
    BRIDGE_WS_PORT,
    storage,
    (raw) => {
      for (const line of stripAnsi(raw).split('\n')) {
        display.pushLine(line)
      }
    },
    (connected, detail) => {
      if (connected) {
        display.setStatus('Connected')
      } else {
        display.setStatus(detail ?? 'Disconnected')
        display.setMicStatus('○ Tap to speak')
      }
    },
  )
  socket.connect()

  let micActive = false
  let lastScrollAt = 0

  const recorder = new VoiceRecorder(
    async (wav) => {
      display.setMicStatus('Processing...')
      try {
        const transcript = await transcribe(wav, STT)
        if (!transcript) { log.warn('empty transcript'); resetMic(); return }

        const cmd = parseCommand(transcript)
        if (cmd.type === 'cancel') { log.info('cancel word — ignoring'); resetMic(); return }

        if (cmd.type === 'ssh') {
          const target = cmd.user ? `${cmd.user}@${cmd.host}` : cmd.host
          log.info(`dispatching ssh → ${target}`)
          display.pushLine(`> ssh ${target}`)
          socket.sendSsh(cmd.host, cmd.user ?? 'user')
        } else {
          log.info(`dispatching cmd → "${cmd.command}"`)
          display.pushLine(`> ${cmd.command}`)
          socket.sendInput(cmd.command)
        }
      } catch (err) {
        log.error('voice pipeline error:', err)
        display.pushLine(`[error: ${String(err)}]`)
      }
      resetMic()
    },
    resetMic,
  )

  function resetMic() {
    micActive = false
    display.setMicStatus('○ Tap to speak')
  }

  async function toggleMic() {
    if (micActive) {
      log.info('mic OFF → processing')
      micActive = false
      await bridge.audioControl(false)
      recorder.stopManually()
      display.setMicStatus('Processing...')
    } else {
      log.info('mic ON')
      micActive = true
      recorder.start()
      await bridge.audioControl(true)
      display.setMicStatus('● Listening...')
    }
  }

  async function teardown() {
    socket.disconnect()
    if (micActive) {
      micActive = false
      await bridge.audioControl(false)
      recorder.cancel()
    }
    unsub()
  }

  bridge.onDeviceStatusChanged((status) => {
    log.info(`glasses status: ${status.connectType}  battery=${status.batteryLevel ?? '?'}%`)
    if (status.connectType === DeviceConnectType.Connected) {
      display.setStatus(`Connected  ${status.batteryLevel ?? '?'}%`)
    }
  })

  const unsub = bridge.onEvenHubEvent((event) => {
    const sysType  = event.sysEvent?.eventType  ?? -1
    const textType = event.textEvent?.eventType ?? 0   // 0 = CLICK (protobuf omits zero)

    // Audio chunk from active mic recording
    if (event.audioEvent?.audioPcm) {
      recorder.feedChunk(event.audioEvent.audioPcm)
      return
    }

    // App lifecycle cleanup
    if (
      sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      void teardown()
      return
    }

    // Double-tap: disconnect and exit
    const isDblClick =
      sysType  === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT
    if (isDblClick) {
      void teardown().then(() => bridge.shutDownPageContainer(1))
      return
    }

    // Scroll up = page back through older output (~300 ms debounce)
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt > 300) { lastScrollAt = now; log.info('scroll back'); display.scrollBack() }
      return
    }

    // Scroll down = page forward toward live tail
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt > 300) { lastScrollAt = now; log.info('scroll forward'); display.scrollForward() }
      return
    }

    // Single tap: toggle mic on/off (CLICK_EVENT === 0; protobuf omits zero fields so tap
    // arrives as undefined → coerced to 0 by the ?? 0 above)
    if (textType === OsEventTypeList.CLICK_EVENT) {
      void toggleMic()
    }
  })
}

void boot().catch(console.error)
