const WS_URL = 'ws://127.0.0.1:7071'
const RECONNECT_DELAY_MS = 3000

export interface NotificationData {
  id: string
  app: string
  from: string
  body: string
  phone: string
  replyable: boolean
  timestamp: number
}

export interface TranscriptData {
  id: string
  text: string
  is_final: boolean
}

export interface ReplyResultData {
  id: string
  success: boolean
}

type NotificationCb = (data: NotificationData) => void
type TranscriptCb = (data: TranscriptData) => void
type ReplyResultCb = (data: ReplyResultData) => void

export class AppsBridgeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private notificationCb: NotificationCb | null = null
  private transcriptCb: TranscriptCb | null = null
  private replyResultCb: ReplyResultCb | null = null

  onNotification(cb: NotificationCb) { this.notificationCb = cb }
  onTranscript(cb: TranscriptCb) { this.transcriptCb = cb }
  onReplyResult(cb: ReplyResultCb) { this.replyResultCb = cb }

  connect() {
    this.ws = new WebSocket(WS_URL)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({
        type: 'client_hello',
        module: 'notifications',
        name: 'Notifications',
        components: ['notifications'],
        managedLifecycle: true,
      }))
    }

    this.ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let frame: Record<string, unknown>
      try { frame = JSON.parse(event.data) } catch { return }

      switch (frame.type) {
        case 'notification':
          this.notificationCb?.(frame.data as NotificationData)
          break
        case 'transcript':
          this.transcriptCb?.(frame as unknown as TranscriptData)
          break
        case 'reply_result':
          this.replyResultCb?.(frame as unknown as ReplyResultData)
          break
      }
    }

    this.ws.onclose = () => this.scheduleReconnect()
    this.ws.onerror = () => {}
  }

  sendAudioStart(id: string) {
    this.sendJson({ type: 'audio_start', id })
  }

  sendAudioChunk(pcm: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm.buffer)
    }
  }

  sendAudioStop(id: string) {
    this.sendJson({ type: 'audio_stop', id })
  }

  sendReply(id: string, phone: string, body: string) {
    this.sendJson({ type: 'send_reply', id, phone, body })
  }

  private sendJson(obj: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_DELAY_MS)
  }
}
