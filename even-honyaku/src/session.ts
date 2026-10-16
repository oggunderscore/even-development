// Persistent WebSocket to the proxy. First message on every connection is `config` (access token + the user's
// own API keys). The mic then streams continuously as binary PCM; `start`/`end` switch the STT mode.

import { dbg } from './debug'
import type { ClientMsg, ServerMsg, StreamMode, UserConfig } from './protocol'
import { isSecureEnough } from './settings'

export interface SessionHandlers {
  onMessage(msg: ServerMsg): void
  onConnection(connected: boolean): void
  /** Read at connect time so a saved settings change applies on the next (re)connect. */
  getServer(): { url: string; config: UserConfig }
}

export class Session {
  private ws: WebSocket | null = null
  /** The socket most recently created; events from any older one (replaced by reset()) are ignored. */
  private current: WebSocket | null = null
  private connecting: Promise<void> | null = null
  /** PCM captured before the socket finished opening. */
  private backlog: Uint8Array[] = []
  /** Why the last connection attempt failed, in words a user can act on. */
  lastError: string | null = null

  constructor(private readonly handlers: SessionHandlers) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): Promise<void> {
    if (this.isOpen) return Promise.resolve()
    if (this.connecting) return this.connecting

    this.connecting = new Promise<void>((resolve, reject) => {
      const { url, config } = this.handlers.getServer()
      const fail = (message: string) => {
        this.lastError = message
        dbg(`connect blocked: ${message}`)
        this.connecting = null
        this.handlers.onConnection(false)
        reject(new Error(message))
      }

      // Keys are sent over this socket, so refuse cleartext to anything that isn't a private network.
      if (!isSecureEnough(url)) {
        fail(`Refusing ${url || '(empty URL)'}: use wss:// or a private address (LAN / Tailscale) so your keys stay encrypted`)
        return
      }

      dbg(`ws connecting → ${url}`)
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (err) {
        fail(`Invalid server URL ${url}: ${err instanceof Error ? err.message : err}`)
        return
      }
      ws.binaryType = 'arraybuffer'
      this.current = ws
      ws.onopen = () => {
        if (this.current !== ws) {
          ws.close()
          reject(new Error('superseded'))
          return
        }
        dbg('ws open')
        this.lastError = null
        this.ws = ws
        this.connecting = null
        ws.send(JSON.stringify({ type: 'config', config } satisfies ClientMsg)) // must be first
        this.handlers.onConnection(true)
        resolve()
      }
      ws.onmessage = (e) => {
        if (this.current !== ws || typeof e.data !== 'string') return
        try {
          const msg = JSON.parse(e.data) as ServerMsg
          dbg(`← ${msg.type}${msg.type === 'error' ? `: ${msg.message}` : ''}`)
          this.handlers.onMessage(msg)
        } catch (err) {
          dbg(`bad frame from server: ${String(e.data).slice(0, 80)} (${err instanceof Error ? err.message : err})`)
        }
      }
      ws.onclose = (e) => {
        if (this.current !== ws) {
          reject(new Error('superseded'))
          return
        }
        this.lastError =
          e.code === 4401
            ? 'Access token rejected — check Settings → Server'
            : `Cannot reach ${url} (close ${e.code}${e.reason ? ` ${e.reason}` : ''}) — server down, wrong address, or blocked by the network whitelist`
        dbg(`ws closed code=${e.code} reason="${e.reason}" clean=${e.wasClean} → ${this.lastError}`)
        if (this.ws === ws) this.ws = null
        this.connecting = null
        this.handlers.onConnection(false)
        reject(new Error('socket closed'))
      }
      ws.onerror = () => {
        if (this.current !== ws) return
        dbg('ws error event')
        ws.close()
      }
    })
    // The rejection is surfaced to whoever awaits connect(); avoid an unhandled-rejection when nobody does.
    this.connecting.catch(() => {})
    return this.connecting
  }

  /** Drop the socket so the next connect() re-sends `config` (after Settings changed). */
  reset() {
    const old = this.ws
    this.ws = null
    this.current = null
    this.connecting = null
    if (old) {
      old.close(1000, 'settings changed')
      this.handlers.onConnection(false)
    }
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
    if (this.isOpen) this.ws!.send(pcm)
    else this.backlog.push(pcm)
  }

  endStream() {
    this.sendJson({ type: 'end' })
  }

  async translateText(text: string): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'text', text })
  }

  /** Ask the server to check the keys it was given and run a sample translation. */
  async test(): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'test' })
  }

  private sendJson(msg: ClientMsg) {
    if (this.isOpen) {
      dbg(`→ ${msg.type}${'mode' in msg ? ` ${msg.mode}` : ''}`)
      this.ws!.send(JSON.stringify(msg))
    } else dbg(`→ ${msg.type} DROPPED (socket not open)`)
  }
}
