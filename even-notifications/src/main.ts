import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { AppsBridgeClient, type NotificationData } from './appsbridge'
import { AudioRecorder } from './audio'
import { initPage, setState, setHeaderText, setBodyText, withSep } from './ui'

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

const INPUT_DEBOUNCE_MS   = 300
const AUTO_RETURN_MS      = 2500
const REC_PULSE_MS        = 750
const MAX_RECORD_MS       = 30_000
const TRANSCRIBE_TIMEOUT_MS = 15_000
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
  let lastClickAt = 0
  let recPulseTimer: ReturnType<typeof setInterval> | null = null
  let recTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  let autoReturnTimer: ReturnType<typeof setTimeout> | null = null
  let transcribeTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  const queue: NotificationData[] = []

  function isState(...states: State[]): boolean {
    return states.includes(state)
  }

  function clearTimers() {
    if (recPulseTimer)  { clearInterval(recPulseTimer);  recPulseTimer  = null }
    if (recTimeoutTimer){ clearTimeout(recTimeoutTimer);  recTimeoutTimer= null }
    if (autoReturnTimer){ clearTimeout(autoReturnTimer);  autoReturnTimer= null }
    if (transcribeTimeoutTimer){ clearTimeout(transcribeTimeoutTimer); transcribeTimeoutTimer = null }
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
        // Safety net: Deepgram never responding (bad/missing key, dropped
        // connection) must not strand the user on this screen forever.
        transcribeTimeoutTimer = setTimeout(() => transition('error'), TRANSCRIBE_TIMEOUT_MS)
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
    // Deepgram streams interim results continuously while the mic is open —
    // show them live during 'recording' itself, not just after tap-to-stop.
    if (!isState('recording', 'transcribing')) return
    transcript = data.text

    if (!data.is_final) {
      await setBodyText(bridge, withSep(transcript || 'Listening...'))
      return
    }

    if (isState('recording')) {
      // Final result from a mid-utterance pause — keep recording, user
      // controls when to actually stop (tap or the 30s safety timeout).
      await setBodyText(bridge, withSep(transcript || 'Listening...'))
      return
    }

    // In 'transcribing' (user already tapped stop) — this is the answer.
    if (transcript.trim()) {
      await transition('review')
    } else {
      // Empty transcript — go back to recording with a hint
      await transition('recording')
      await setBodyText(bridge, withSep("Didn't catch that.\nTry speaking again."))
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
      const now = Date.now()
      if (now - lastClickAt < INPUT_DEBOUNCE_MS) return
      lastClickAt = now

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

      // Exactly one transition per tap — `state` mutates synchronously inside
      // transition() before its awaits resolve, so re-checking isState() after
      // an await here would cascade through several transitions in one tap.
      if (isState('notify')) {
        await transition('recording')
      } else if (isState('recording')) {
        await transition('transcribing')
      } else if (isState('transcribing')) {
        await transition('notify') // cancel — let the user retry
      } else if (isState('review')) {
        client.sendReply(currentNotif!.id, currentNotif!.phone, transcript)
        // Optimistically show sent; onReplyResult corrects on failure
        await transition('sent')
      }
    }

    // Swipe down — skip notification
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt < INPUT_DEBOUNCE_MS) return
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
      if (now - lastScrollAt < INPUT_DEBOUNCE_MS) return
      lastScrollAt = now
      if (isState('review')) await transition('recording')
    }
  })

  // Start connecting only after onboarding is done (skipped above if already onboarded)
}

main()
