// Persistent WebSocket to the proxy. One "turn" = start → binary PCM chunks → end → done.

import { SERVER_TOKEN, SERVER_URL } from './config'
import type { ClientMsg, Direction, ServerMsg } from './protocol'

export interface SessionHandlers {
  onMessage(msg: ServerMsg): void
  onConnection(connected: boolean): void
}

export class Session {
  private ws: WebSocket | null = null
  private connecting: Promise<void> | null = null
  /** PCM captured before the socket finished opening. */
  private backlog: Uint8Array[] = []

  constructor(private readonly handlers: SessionHandlers) {}

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const url = `${SERVER_URL}/?token=${encodeURIComponent(SERVER_TOKEN)}`
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        this.ws = ws
        this.connecting = null
        this.handlers.onConnection(true)
        resolve()
      }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return
        try {
          this.handlers.onMessage(JSON.parse(e.data) as ServerMsg)
        } catch {
          /* ignore malformed frame */
        }
      }
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        this.connecting = null
        this.handlers.onConnection(false)
        reject(new Error('socket closed'))
      }
      ws.onerror = () => ws.close()
    })
    // The rejection is surfaced to whoever awaits connect(); avoid an unhandled-rejection when nobody does.
    this.connecting.catch(() => {})
    return this.connecting
  }

  async startTurn(dir: Direction): Promise<void> {
    this.backlog = []
    await this.connect()
    this.sendJson({ type: 'start', dir })
    for (const chunk of this.backlog) this.ws?.send(chunk)
    this.backlog = []
  }

  sendAudio(pcm: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
    else this.backlog.push(pcm)
  }

  endTurn() {
    this.sendJson({ type: 'end' })
  }

  async translateText(dir: Direction, text: string): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'text', dir, text })
  }

  private sendJson(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
}
