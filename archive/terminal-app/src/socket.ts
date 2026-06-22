// WebSocket client for the warp-g2-bridge daemon.
//
// Connection cascade (runs on every connect/reconnect):
//   1. Try URL cached in local storage        — fast path after first connect
//   2. Try ws://HOSTNAME.local:PORT directly  — mDNS WebSocket, no HTTP needed
//   3. GET http://HOSTNAME.local:8767/discover — mDNS + HTTP fallback
//   4. Give up, report error

import { makeLog } from './log'

const log = makeLog('socket')

const DISCOVERY_PORT = 8767
const STORAGE_KEY    = 'g2_bridge_url'

export interface StorageAdapter {
  get(key: string): Promise<string>
  set(key: string, value: string): Promise<boolean>
}

export class BridgeSocket {
  private ws: WebSocket | null = null
  private reconnectDelay = 2_000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closing = false

  constructor(
    private readonly hostname: string,
    private readonly wsPort: number,
    private readonly storage: StorageAdapter,
    private readonly onOutput: (data: string) => void,
    private readonly onStatus: (connected: boolean, detail?: string) => void,
  ) {}

  connect() {
    this.closing = false
    log.info(`connect() hostname=${this.hostname} port=${this.wsPort}`)
    void this.openWithDiscovery()
  }

  sendInput(command: string) {
    log.info(`→ input: "${command}"`)
    this.send({ type: 'input', sessionId: this.sessionId(), data: command })
  }

  sendSsh(host: string, user: string) {
    log.info(`→ ssh: ${user}@${host}`)
    this.send({ type: 'ssh', sessionId: this.sessionId(), host, user })
  }

  disconnect() {
    log.info('disconnect() requested')
    this.closing = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close()
  }

  // ── Discovery + connect ──────────────────────────────────────────────────────

  private async openWithDiscovery(): Promise<void> {
    this.onStatus(false, 'Connecting...')

    // 1. Try cached IP URL
    const cached = await this.storage.get(STORAGE_KEY).catch(() => '')
    if (cached) {
      log.info(`try cached: ${cached}`)
      if (await this.tryConnect(cached)) return
      log.warn('cached URL failed')
    }

    // 2. Try direct mDNS WebSocket
    this.onStatus(false, `Finding ${this.hostname}.local...`)
    const mdnsUrl = `ws://${this.hostname}.local:${this.wsPort}`
    log.info(`try mDNS WS: ${mdnsUrl}`)
    if (await this.tryConnect(mdnsUrl)) {
      await this.storage.set(STORAGE_KEY, mdnsUrl).catch(() => false)
      return
    }
    log.warn('mDNS WS failed')

    // 3. HTTP discovery endpoint → get real IP URL
    const discoverUrl = `http://${this.hostname}.local:${DISCOVERY_PORT}/discover`
    log.info(`try discover: ${discoverUrl}`)
    try {
      const res  = await fetchWithTimeout(discoverUrl, 5_000)
      const data = (await res.json()) as { wsUrl?: string }
      log.info('discover response:', data)
      if (data.wsUrl) {
        await this.storage.set(STORAGE_KEY, data.wsUrl).catch(() => false)
        if (await this.tryConnect(data.wsUrl)) return
      }
    } catch (err) {
      log.warn('discover failed:', String(err))
    }

    // 4. All paths exhausted
    log.error('all connection paths failed')
    this.onStatus(false, 'Bridge unreachable — is it running?')
    if (!this.closing) this.scheduleReconnect()
  }

  private tryConnect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.closing) { resolve(false); return }

      this.ws?.close()

      let settled = false
      const settle = (success: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(connectTimeout)
        resolve(success)
      }

      const connectTimeout = setTimeout(() => {
        log.warn(`connect timeout: ${url}`)
        this.ws?.close()
        settle(false)
      }, 3_000)

      try {
        this.ws = new WebSocket(url)
      } catch (err) {
        log.warn(`WebSocket() threw: ${String(err)}`)
        settle(false)
        return
      }

      this.ws.onopen = () => {
        this.reconnectDelay = 2_000
        log.info(`connected: ${url}  session=${this.sessionId()}`)
        this.onStatus(true)
        this.send({ type: 'spawn', sessionId: this.sessionId() })
        settle(true)
      }

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, string>
          if (msg['type'] === 'output') {
            const chars = (msg['data'] ?? '').length
            if (chars > 0) log.info(`← output ${chars} chars`)
            this.onOutput(msg['data'] ?? '')
          }
          if (msg['type'] === 'error') {
            log.warn(`← bridge error: ${msg['message']}`)
            this.onOutput(`[bridge: ${msg['message']}]`)
          }
        } catch { /* ignore malformed */ }
      }

      this.ws.onclose = () => {
        settle(false)
        if (!this.closing) {
          log.warn(`disconnected, retry in ${this.reconnectDelay}ms`)
          this.onStatus(false, 'Disconnected — reconnecting...')
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        log.warn(`socket error on ${url}`)
        this.ws?.close()
        settle(false)
      }
    })
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000)
      log.info(`reconnecting... (delay was ${this.reconnectDelay}ms)`)
      void this.openWithDiscovery()
    }, this.reconnectDelay)
  }

  private _sessionId: string | null = null
  private sessionId(): string {
    if (!this._sessionId) this._sessionId = `g2-${Date.now()}`
    return this._sessionId
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
}
