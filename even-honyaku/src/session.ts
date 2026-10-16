// The link to the translation engine, in one of two modes (chosen in Settings):
//
//   direct  – the engine (src/core) runs right here in the WebView and calls Deepgram and the user's translation
//             provider straight from the phone. No server to run or host.
//   server  – a persistent WebSocket to your own proxy (server/), which runs the same engine. The first message is
//             `config` (access token + the user's own API keys); the mic then streams as binary PCM.
//
// Either way the rest of the app sees the same API and the same ServerMsg events.

import { Engine } from './core/engine'
import { dbg } from './debug'
import type { ClientMsg, ServerMsg, StreamMode, UserConfig } from './protocol'
import { type Mode, isSecureEnough } from './settings'

export interface SessionHandlers {
  onMessage(msg: ServerMsg): void
  onConnection(connected: boolean): void
  /** Read at connect time so a saved settings change applies on the next (re)connect. */
  getTarget(): { mode: Mode; url: string; config: UserConfig }
}

export class Session {
  private ws: WebSocket | null = null
  /** The socket most recently created; events from any older one (replaced by reset()) are ignored. */
  private current: WebSocket | null = null
  private engine: Engine | null = null
  private connecting: Promise<void> | null = null
  /** PCM captured before the link was up. */
  private backlog: Uint8Array[] = []
  /** Why the last connection attempt failed, in words a user can act on. */
  lastError: string | null = null

  constructor(private readonly handlers: SessionHandlers) {}

  get isOpen(): boolean {
    return this.engine !== null || this.ws?.readyState === WebSocket.OPEN
  }

  connect(): Promise<void> {
    if (this.isOpen) return Promise.resolve()
    if (this.connecting) return this.connecting
    const target = this.handlers.getTarget()
    if (target.mode === 'direct') return this.connectDirect(target.config)
    return this.connectServer(target.url, target.config)
  }

  // ── direct ─────────────────────────────────────────────────────────────────

  private connectDirect(config: UserConfig): Promise<void> {
    dbg('direct mode: engine running on this device')
    const engine = new Engine(
      (msg) => {
        dbg(`← ${msg.type}${msg.type === 'error' ? `: ${msg.message}` : ''}`)
        this.handlers.onMessage(msg)
      },
      {},
      'direct',
    )
    this.engine = engine
    this.lastError = null
    engine.handle({ type: 'config', config: { ...config, token: undefined } })
    this.handlers.onConnection(true)
    return Promise.resolve()
  }

  // ── server ─────────────────────────────────────────────────────────────────

  private connectServer(url: string, config: UserConfig): Promise<void> {
    this.connecting = new Promise<void>((resolve, reject) => {
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
            ? 'Access token rejected — check Settings → Connection'
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

  /** Drop the link so the next connect() starts fresh with the current settings (mode, keys, address). */
  reset() {
    const old = this.ws
    const hadEngine = this.engine !== null
    this.ws = null
    this.current = null
    this.connecting = null
    this.engine?.close()
    this.engine = null
    if (old) old.close(1000, 'settings changed')
    if (old || hadEngine) this.handlers.onConnection(false)
  }

  // ── API used by the app ────────────────────────────────────────────────────

  async startStream(mode: StreamMode): Promise<void> {
    this.backlog = []
    await this.connect()
    this.sendJson({ type: 'start', mode })
    if (this.backlog.length) dbg(`flushing ${this.backlog.length} backlogged audio chunks`)
    for (const chunk of this.backlog) this.pushAudio(chunk)
    this.backlog = []
  }

  sendAudio(pcm: Uint8Array) {
    if (this.isOpen) this.pushAudio(pcm)
    else this.backlog.push(pcm)
  }

  endStream() {
    this.sendJson({ type: 'end' })
  }

  async translateText(text: string): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'text', text })
  }

  /** Check the keys in use and run a sample translation. */
  async test(): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'test' })
  }

  private pushAudio(pcm: Uint8Array) {
    if (this.engine) this.engine.audio(pcm)
    else this.ws?.send(pcm)
  }

  private sendJson(msg: ClientMsg) {
    if (!this.isOpen) {
      dbg(`→ ${msg.type} DROPPED (not connected)`)
      return
    }
    dbg(`→ ${msg.type}${'mode' in msg ? ` ${msg.mode}` : ''}`)
    if (this.engine) this.engine.handle(msg)
    else this.ws!.send(JSON.stringify(msg))
  }
}
