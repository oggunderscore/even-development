// Persistent WebSocket to the proxy. The mic streams continuously as binary PCM; `start`/`end` switch the STT mode.

import { SERVER_TOKEN, SERVER_URL } from './config'
import { dbg } from './debug'
import type { ClientMsg, ServerMsg, StreamMode } from './protocol'

export interface SessionHandlers {
  onMessage(msg: ServerMsg): void
  onConnection(connected: boolean): void
}

export class Session {
  private ws: WebSocket | null = null
  private connecting: Promise<void> | null = null
  /** PCM captured before the socket finished opening. */
  private backlog: Uint8Array[] = []
  /** Why the last connection attempt failed, in words a user can act on. */
  lastError: string | null = null

  constructor(private readonly handlers: SessionHandlers) {}

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const url = `${SERVER_URL}/?token=${encodeURIComponent(SERVER_TOKEN)}`
      dbg(`ws connecting → ${SERVER_URL} (token ${SERVER_TOKEN ? `${SERVER_TOKEN.length} chars` : 'EMPTY'})`)
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        this.lastError = `Invalid server URL ${SERVER_URL}: ${err instanceof Error ? err.message : err}`
        dbg(`ws constructor threw: ${this.lastError}`)
        this.connecting = null
        reject(new Error(this.lastError))
        return
      }
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        dbg('ws open')
        this.lastError = null
        this.ws = ws
        this.connecting = null
        this.handlers.onConnection(true)
        resolve()
      }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return
        try {
          const msg = JSON.parse(e.data) as ServerMsg
          dbg(`← ${msg.type}${msg.type === 'error' ? `: ${msg.message}` : ''}`)
          this.handlers.onMessage(msg)
        } catch (err) {
          dbg(`bad frame from server: ${String(e.data).slice(0, 80)} (${err instanceof Error ? err.message : err})`)
        }
      }
      ws.onclose = (e) => {
        this.lastError =
          e.code === 4401
            ? 'Unauthorized: VITE_SERVER_TOKEN does not match HONYAKU_TOKEN'
            : `Cannot reach ${SERVER_URL} (close ${e.code}${e.reason ? ` ${e.reason}` : ''}) — server down, wrong IP, or ws:// blocked by the network whitelist`
        dbg(`ws closed code=${e.code} reason="${e.reason}" clean=${e.wasClean} → ${this.lastError}`)
        if (this.ws === ws) this.ws = null
        this.connecting = null
        this.handlers.onConnection(false)
        reject(new Error('socket closed'))
      }
      ws.onerror = () => {
        dbg('ws error event')
        ws.close()
      }
    })
    // The rejection is surfaced to whoever awaits connect(); avoid an unhandled-rejection when nobody does.
    this.connecting.catch(() => {})
    return this.connecting
  }

  async startStream(mode: StreamMode): Promise<void> {
    this.backlog = []
    await this.connect()
    this.sendJson({ type: 'start', mode })
    if (this.backlog.length) dbg(`flushing ${this.backlog.length} backlogged audio chunks`)
    for (const chunk of this.backlog) this.ws?.send(chunk)
    this.backlog = []
  }

  sendAudio(pcm: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
    else this.backlog.push(pcm)
  }

  endStream() {
    this.sendJson({ type: 'end' })
  }

  async translateText(text: string): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'text', text })
  }

  private sendJson(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      dbg(`→ ${msg.type}${'mode' in msg ? ` ${msg.mode}` : ''}`)
      this.ws.send(JSON.stringify(msg))
    } else dbg(`→ ${msg.type} DROPPED (socket not open)`)
  }
}
