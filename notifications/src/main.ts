import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { AppsBridgeClient, type NotificationData } from './appsbridge'
import { AudioRecorder } from './audio'
import { initPage, setState, setBodyText } from './ui'

type State =
  | 'idle'
  | 'notify'
  | 'recording'
  | 'transcribing'
  | 'review'
  | 'sent'
  | 'error'

const SCROLL_DEBOUNCE_MS = 300
const AUTO_RETURN_MS = 2000

async function main() {
  const bridge = await waitForEvenAppBridge()
  await initPage(bridge)

  const client = new AppsBridgeClient()
  const recorder = new AudioRecorder(bridge)

  let state: State = 'idle'
  let currentNotif: NotificationData | null = null
  let transcript = ''
  let lastScrollAt = 0

  function isState(...states: State[]): boolean {
    return states.includes(state)
  }

  async function transition(next: State) {
    state = next
    switch (next) {
      case 'idle':
        currentNotif = null
        transcript = ''
        await setState(bridge, { name: 'idle' })
        break
      case 'notify':
        await setState(bridge, {
          name: 'notify',
          app: currentNotif!.app,
          from: currentNotif!.from,
          body: currentNotif!.body,
        })
        break
      case 'recording':
        transcript = ''
        await setState(bridge, { name: 'recording' })
        client.sendAudioStart(currentNotif!.id)
        await recorder.startRecording((pcm) => client.sendAudioChunk(pcm))
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
        setTimeout(() => transition('idle'), AUTO_RETURN_MS)
        break
      case 'error':
        await setState(bridge, { name: 'error' })
        setTimeout(() => transition('idle'), AUTO_RETURN_MS)
        break
    }
  }

  // Incoming notification from APPS Bridge
  client.onNotification(async (notif) => {
    if (!isState('idle')) return
    currentNotif = notif
    await transition('notify')
  })

  // Transcript updates (partial + final)
  client.onTranscript(async (data) => {
    if (!isState('transcribing')) return
    transcript = data.text
    if (data.is_final) {
      await transition('review')
    } else {
      await setBodyText(bridge, data.text)
    }
  })

  // Reply send result
  client.onReplyResult(async (result) => {
    if (!isState('sent', 'review')) return
    await transition(result.success ? 'sent' : 'error')
  })

  // Input events
  const unsub = bridge.onEvenHubEvent(async (event) => {
    const sysType  = event.sysEvent?.eventType  ?? -1
    const textType = event.textEvent?.eventType ?? 0

    // Double-tap exits (required on root page)
    if (
      sysType  === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT
    ) {
      if (isState('recording')) await recorder.stopRecording()
      unsub()
      await bridge.shutDownPageContainer(1)
      return
    }

    // Lifecycle: clean up recording if app exits unexpectedly
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
      if (isState('notify'))        await transition('recording')
      else if (isState('recording')) await transition('transcribing')
      else if (isState('review')) {
        client.sendReply(currentNotif!.id, currentNotif!.phone, transcript)
        // Optimistically show sent; onReplyResult will correct on failure
        await transition('sent')
      }
    }

    // Swipe down — dismiss notification
    if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt < SCROLL_DEBOUNCE_MS) return
      lastScrollAt = now
      if (isState('notify')) await transition('idle')
    }

    // Swipe up — redo recording
    if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
      const now = Date.now()
      if (now - lastScrollAt < SCROLL_DEBOUNCE_MS) return
      lastScrollAt = now
      if (isState('review')) await transition('recording')
    }
  })

  client.connect()
}

main()
