/**
 * WebSocket client for the Flipper bridge.
 *
 * Implements the JSON wire protocol shared with the Android bridge:
 *   Bridge -> client:
 *     { type:"status", state:"scanning"|"connected"|"disconnected", info?:string }
 *     { type:"frame",  w:128, h:64, bpp:1, seq:number, data:"<base64 of 1024 bytes>" }
 *   Client -> bridge:
 *     { type:"connect" } | { type:"disconnect" }
 *     { type:"button", key:"up"|"down"|"left"|"right"|"ok"|"back",
 *       action:"short"|"long"|"press"|"release" }
 *     { type:"ready" }   // flow-control credit: rendered last frame, send next
 */

export type StatusState = 'scanning' | 'connected' | 'disconnected'

export type StatusMessage = {
  type: 'status'
  state: StatusState
  info?: string
}

export type FrameMessage = {
  type: 'frame'
  w: 128
  h: 64
  bpp: 1
  seq: number
  data: string // base64 of 1024 bytes
}

export type ServerMessage = StatusMessage | FrameMessage

export type ButtonKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
export type ButtonAction = 'short' | 'long' | 'press' | 'release'

export type StatusListener = (msg: StatusMessage) => void
export type FrameListener = (frame: Uint8Array, seq: number) => void

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 16000

export class FlipperClient {
  private url: string
  private ws: WebSocket | null = null
  private statusListeners = new Set<StatusListener>()
  private frameListeners = new Set<FrameListener>()
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private lastReconnectInfo = ''

  constructor(url: string) {
    this.url = url
  }

  start(): void {
    this.stopped = false
    this.open()
  }

  /**
   * Force a fresh connection immediately, tearing down any existing socket.
   *
   * Used on foreground-enter: when the Even app is backgrounded the WebView's
   * timers are frozen and the OS often kills the socket without ever firing
   * `onclose` (or leaves it half-open). On return the old `ws` looks alive but
   * no frames flow and the backoff timer may be stuck mid-wait - the user sees
   * a frozen "connecting…" and a stale frame. Dropping the dead socket and
   * reopening with the backoff reset gets the mirror live again at once.
   */
  reconnectNow(): void {
    if (this.stopped) return
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectDelay = RECONNECT_MIN_MS
    const old = this.ws
    if (old) {
      // Detach onclose first so tearing the dead socket down doesn't schedule
      // a competing reconnect that races the fresh open() below.
      old.onclose = null
      old.onmessage = null
      old.onerror = null
      old.onopen = null
      try {
        old.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  /** Ask the bridge to begin/stop the Flipper link. */
  connect(): void {
    this.sendJson({ type: 'connect' })
  }

  disconnect(): void {
    this.sendJson({ type: 'disconnect' })
  }

  sendButton(key: ButtonKey, action: ButtonAction): void {
    this.sendJson({ type: 'button', key, action })
  }

  /**
   * Flow-control credit: tell the bridge we've finished rendering the last
   * frame and want the next one. Drives the closed-loop pacing - the bridge
   * holds only the freshest frame and ships it the instant this arrives, so we
   * render as fast as the glasses can actually draw and no faster.
   */
  sendReady(): void {
    this.sendJson({ type: 'ready' })
  }

  /** Human-readable reconnect info, surfaced to the status overlay. */
  reconnectInfo(): string {
    return this.lastReconnectInfo
  }

  private sendJson(payload: unknown): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  private open(): void {
    if (this.stopped) return
    this.lastReconnectInfo = ''
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.lastReconnectInfo = ''
      // Ask bridge to start the Flipper link. Bridge may also auto-start.
      this.sendJson({ type: 'connect' })
    }

    ws.onmessage = (ev) => this.handleMessage(ev.data)

    ws.onerror = () => {
      // Surfaced via onclose; no separate action.
    }

    ws.onclose = () => {
      this.ws = null
      this.emitStatus({
        type: 'status',
        state: 'disconnected',
        info: 'socket closed',
      })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = this.reconnectDelay
    this.lastReconnectInfo = `retrying in ${Math.round(delay / 1000)}s`
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      this.open()
    }, delay)
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      return
    }
    if (msg.type === 'status') {
      this.emitStatus(msg)
    } else if (msg.type === 'frame') {
      const bytes = decodeBase64(msg.data)
      if (bytes.length !== 1024) return
      for (const cb of this.frameListeners) cb(bytes, msg.seq)
    }
  }

  private emitStatus(msg: StatusMessage): void {
    for (const cb of this.statusListeners) cb(msg)
  }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
