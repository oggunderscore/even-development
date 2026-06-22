import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { AppsBridgeClient, type NotificationData } from './appsbridge'
import { AudioRecorder } from './audio'
import { initPage, setState, setHeaderText, setBodyText } from './ui'

type State =
  | 'onboarding'
  | 'connecting'
  | 'idle'
  | 'notify'
  | 'recording'
  | 'transcribing'
  | 'review'
  | 'sent'
  | 'error'

const SCROLL_DEBOUNCE_MS  = 300
const AUTO_RETURN_MS      = 2500
const REC_PULSE_MS        = 750
const MAX_RECORD_MS       = 45_000
const ONBOARDED_KEY       = 'notif_onboarded_v1'

async function main() {
  const bridge = await waitForEvenAppBridge()
  await initPage(bridge)

  const client   = new AppsBridgeClient()
  const recorder = new AudioRecorder(bridge)

  let state: State = 'connecting'
  let onboardingStep: 1 | 2 | 3 = 1
  let currentNotif: NotificationData | null = null
  let transcript = ''
  let lastScrollAt = 0
  let recPulseTimer: ReturnType<typeof setInterval> | null = null
  let recTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  let autoReturnTimer: ReturnType<typeof setTimeout> | null = null
  const queue: NotificationData[] = []

  function isState(...states: State[]): boolean {
    return states.includes(state)
  }

  function clearTimers() {
    if (recPulseTimer)  { clearInterval(recPulseTimer);  recPulseTimer  = null }
    if (recTimeoutTimer){ clearTimeout(recTimeoutTimer);  recTimeoutTimer= null }
    if (autoReturnTimer){ clearTimeout(autoReturnTimer);  autoReturnTimer= null }
  }

  // ── Recording pulse ────────────────────────────────────────────────────────

  function startRecordingPulse() {
    let lit = true
    recPulseTimer = setInterval(async () => {
      lit = !lit
      await setHeaderText(bridge, lit ? '● Recording' : '○ Recording')
    }, REC_PULSE_MS)
  }

  // ── State machine ──────────────────────────────────────────────────────────

  async function transition(next: State) {
    clearTimers()
    state = next

    switch (next) {

      case 'onboarding':
        await setState(bridge, { name: 'onboarding', step: onboardingStep })
        break

      case 'connecting':
        await setState(bridge, { name: 'connecting' })
        break

      case 'idle': {
        currentNotif = null
        transcript   = ''
        if (queue.length > 0) {
          await setState(bridge, { name: 'idle_queued', count: queue.length })
        } else {
          await setState(bridge, { name: 'idle' })
        }
        break
      }

      case 'notify':
        await setState(bridge, {
          name: 'notify',
          app:  currentNotif!.app,
          from: currentNotif!.from,
          body: currentNotif!.body,
        })
        break

      case 'recording':
        transcript = ''
        await setState(bridge, { name: 'recording' })
        startRecordingPulse()
        client.sendAudioStart(currentNotif!.id)
        await recorder.startRecording((pcm) => client.sendAudioChunk(pcm))
        // Safety timeout: auto-stop after MAX_RECORD_MS
        recTimeoutTimer = setTimeout(() => transition('transcribing'), MAX_RECORD_MS)
        break

      case 'transcribing':
        await recorder.stopRecording()
        client.sendAudioStop(currentNotif!.id)
        await setState(bridge, { name: 'transcribing', partial: '' })
        break

      case 'review':
        await setState(bridge, { name: 'review', transcript })
        break

      case 'sent':
        await setState(bridge, { name: 'sent', from: currentNotif!.from })
        autoReturnTimer = setTimeout(() => transition('idle'), AUTO_RETURN_MS)
        break

      case 'error':
        await setState(bridge, { name: 'error' })
        autoReturnTimer = setTimeout(() => transition('idle'), AUTO_RETURN_MS)
        break
    }
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────

  const hasOnboarded = await bridge.getLocalStorage(ONBOARDED_KEY).catch(() => '')
  if (!hasOnboarded) {
    state = 'onboarding'
    await transition('onboarding')
  } else {
    await transition('connecting')
    client.connect()
  }

  // ── APPS Bridge events ─────────────────────────────────────────────────────

  client.onConnect(async () => {
    if (isState('connecting')) await transition('idle')
  })

  client.onDisconnect(async () => {
    if (isState('recording')) {
      await recorder.stopRecording()
    }
    // Preserve notification in queue if interrupted mid-flow
    if (currentNotif && !isState('idle', 'connecting', 'onboarding')) {
      if (!queue.find(n => n.id === currentNotif!.id)) {
        queue.unshift(currentNotif)
      }
    }
    clearTimers()
    state = 'connecting'
    await setState(bridge, { name: 'disconnected' })
  })

  client.onNotification(async (notif) => {
    if (isState('idle')) {
      currentNotif = notif
      await transition('notify')
    } else {
      // Queue notifications that arrive while busy
      if (!queue.find(n => n.id === notif.id)) {
        queue.push(notif)
      }
      // Update idle badge if we're returning to idle shortly
      if (isState('sent', 'error')) {
        await setBodyText(bridge, `+${queue.length} more waiting`)
      }
    }
  })

  client.onTranscript(async (data) => {
    if (!isState('transcribing')) return
    transcript = data.text
    if (data.is_final) {
      if (transcript.trim()) {
        await transition('review')
      } else {
        // Empty transcript — go back to recording with a hint
        await setState(bridge, { name: 'recording' })
        await setBodyText(bridge, "Didn't catch that.\nTry speaking again.")
        startRecordingPulse()
        client.sendAudioStart(currentNotif!.id)
        await recorder.startRecording((pcm) => client.sendAudioChunk(pcm))
        state = 'recording'
      }
    } else {
      await setBodyText(bridge, data.text)
    }
  })

  client.onReplyResult(async (result) => {
    if (!isState('sent', 'review')) return
    await transition(result.success ? 'sent' : 'error')
  })

  // ── Input events ───────────────────────────────────────────────────────────

  const unsub = bridge.onEvenHubEvent(async (event) => {
    const sysType  = event.sysEvent?.eventType  ?? -1
    const textType = event.textEvent?.eventType ?? 0

    // Double-tap: exit (required on root page for QA)
    if (
      sysType  === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT
    ) {
      if (isState('recording')) await recorder.stopRecording()
      unsub()
      await bridge.shutDownPageContainer(1)
      return
    }

    // System lifecycle cleanup
    if (
      sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
    ) {
      if (isState('recording')) await recorder.stopRecording()
      unsub()
      return
    }

    // Single tap
    if (textType === OsEventTypeList.CLICK_EVENT) {
      if (isState('onboarding')) {
        if (onboardingStep < 3) {
          onboardingStep = (onboardingStep + 1) as 1 | 2 | 3
          await setState(bridge, { name: 'onboarding', step: onboardingStep })
        } else {
          // Onboarding complete — save and connect
          await bridge.setLocalStorage(ONBOARDED_KEY, '1')
          await transition('connecting')
          client.connect()
        }
        return
      }

      if (isState('idle') && queue.length > 0) {
        currentNotif = queue.shift()!
        await transition('notify')
        return
      }

      if (isState('notify'))        await transition('recording')
      if (isState('recording'))     await transition('transcribing')
      if (isState('review')) {
        client.sendReply(currentNotif!.id, currentNotif!.phone, transcript)
        // Optimistically show sent; onReplyResult corrects on failure
        await transition('sent')
      }
    }

    // Swipe down — skip notification
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt < SCROLL_DEBOUNCE_MS) return
      lastScrollAt = now
      if (isState('notify')) {
        // If more are queued, show next immediately
        if (queue.length > 0) {
          currentNotif = queue.shift()!
          await transition('notify')
        } else {
          await transition('idle')
        }
      }
    }

    // Swipe up — re-record
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt < SCROLL_DEBOUNCE_MS) return
      lastScrollAt = now
      if (isState('review')) await transition('recording')
    }
  })

  // Start connecting only after onboarding is done (skipped above if already onboarded)
}

main()
