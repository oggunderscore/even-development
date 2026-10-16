// Honyaku proxy: G2 app ⇄ Deepgram STT ⇄ translation (Google / OpenRouter / Anthropic).
//
// Each user brings their own API keys: the app's first message is {config} (access token + keys), held only in
// that connection's memory. Nothing else is accepted until it arrives, and keys are never logged or stored.
//
//   client → {config} → {start,mode} → binary PCM… (continuous)  → {end}?
//   server → partial… → final… → done (after an explicit end)
//
// mode "auto": always-on, English + Japanese detected per utterance (restarted automatically if Deepgram drops).
// mode "talk": wearer holds the button — English only, always translated to Japanese romaji.

import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, Direction, ServerMsg, StreamMode, Translation } from '../../src/protocol'
import { type ResolvedConfig, missingKeys, resolveConfig, serverKeysAllowed, validateConfig } from './config'
import { runStartupChecks } from './diagnostics'
import { log, warn } from './log'
import { testConfig } from './probes'
import { type Stt, createStt } from './stt'
import { detectDir, translate } from './translate'

const PORT = Number(process.env['PORT'] ?? 8787)
const TOKEN = process.env['HONYAKU_TOKEN'] ?? ''
if (!TOKEN) console.warn('HONYAKU_TOKEN is empty — anyone who can reach this port can spend your API credits.')

const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '')
})
// Control messages are tiny; an oversized frame is never legitimate (audio chunks are ~3 KB).
const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 })

let nextConn = 1
const AUTH_TIMEOUT_MS = 5000

wss.on('connection', (socket, req) => {
  const id = nextConn++
  const from = `${req.socket.remoteAddress} origin=${req.headers.origin ?? '-'}`
  log('conn', `#${id} open from ${from}`)
  new Conn(socket, id)
})

/** Ignore recogniser noise like a lone "uh" / "。". */
const tooShort = (text: string) => text.replace(/\s/g, '').length < 2

class Conn {
  private stt: Stt | null = null
  /** The access token is checked on `config`; with no HONYAKU_TOKEN set the server is open. */
  private authed = !TOKEN
  private cfg: ResolvedConfig = resolveConfig()
  private mode: StreamMode | null = null
  private history: Translation[] = []
  private nextId = 1
  private audioBytes = 0
  private audioChunks = 0
  private lastStatBytes = 0
  private restarts: number[] = []
  private readonly statTimer: ReturnType<typeof setInterval>
  /** Translations are chained so results reach the glasses in speech order. */
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly socket: WebSocket, private readonly id: number) {
    this.send({ type: 'ready' })
    const authTimer = TOKEN
      ? setTimeout(() => {
          if (!this.authed) {
            warn(this.tag, 'no valid config/token within 5s — closing')
            socket.close(4401, 'unauthorized')
          }
        }, AUTH_TIMEOUT_MS)
      : undefined
    socket.on('close', () => clearTimeout(authTimer))
    socket.on('message', (data, isBinary) => {
      if (!this.authed && isBinary) return
      if (isBinary) {
        const buf = data as Buffer
        this.audioBytes += buf.length
        if (++this.audioChunks === 1) log(this.tag, `first audio chunk: ${buf.length} bytes${this.stt ? '' : ' (NO active stt stream — dropped)'}`)
        if (process.env['DEBUG_AUDIO']) log(this.tag, `audio ${buf.length}B`)
        this.stt?.audio(buf)
      } else this.onClient(data.toString())
    })
    socket.on('close', (code, reason) => {
      log(this.tag, `closed (${code}${reason.length ? ` ${reason}` : ''})`)
      clearInterval(this.statTimer)
      this.mode = null
      this.stt?.abort()
    })
    socket.on('error', (err) => warn(this.tag, `socket error: ${err.message}`))
    // Heartbeat so a silent mic is obvious in the log while always-on listening runs.
    this.statTimer = setInterval(() => {
      if (!this.mode) return
      const delta = this.audioBytes - this.lastStatBytes
      this.lastStatBytes = this.audioBytes
      log(this.tag, `mode=${this.mode} audio last 15s: ${(delta / 32000).toFixed(1)}s${delta === 0 ? '  ← NO AUDIO arriving from the app' : ''}`)
    }, 15000)
  }

  private get tag() {
    return `conn#${this.id}`
  }

  private onClient(raw: string) {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      warn(this.tag, `ignoring non-JSON text frame: ${raw.slice(0, 60)}`)
      return
    }
    // Never log a whole message: `config` carries the user's keys.
    log(this.tag, `← ${msg.type}${'mode' in msg ? ` mode=${msg.mode}` : ''}${msg.type === 'text' ? ` "${msg.text}"` : ''}`)
    if (msg.type === 'config') {
      this.onConfig(msg.config)
      return
    }
    if (!this.authed) {
      this.send({ type: 'error', message: 'Not authenticated — send config with the access token first' })
      return
    }
    switch (msg.type) {
      case 'test':
        void this.runTest()
        break
      case 'start':
        this.start(msg.mode)
        break
      case 'end':
        void this.end()
        break
      case 'text':
        if (this.requireKeys(['translate'])) this.enqueue(detectDir(msg.text), msg.text)
        break
    }
  }

  private onConfig(user: Parameters<typeof validateConfig>[0]) {
    if (TOKEN && user?.token !== TOKEN) {
      warn(this.tag, `REJECTED: token mismatch (client sent ${user?.token ? `${user.token.length} chars` : 'nothing'}, server expects ${TOKEN.length}). Set the same access token in the app's Settings (or VITE_SERVER_TOKEN).`)
      this.socket.close(4401, 'unauthorized: token mismatch')
      return
    }
    const problem = user ? validateConfig(user) : null
    if (problem) {
      this.send({ type: 'error', message: problem })
      return
    }
    this.authed = true
    this.cfg = resolveConfig(user)
    const missing = missingKeys(this.cfg)
    log(this.tag, `config ok: provider=${this.cfg.translate.provider} engine=${this.cfg.listenEngine} stt=${!missing.includes('deepgram')} translate=${!missing.includes('translate')} serverKeys=${this.cfg.usingServerKeys}`)
    this.send({
      type: 'config_ok',
      stt: !missing.includes('deepgram'),
      translate: !missing.includes('translate'),
      provider: this.cfg.translate.provider,
      serverKeys: this.cfg.usingServerKeys,
    })
  }

  /** Tell the app which key is missing (it opens Settings) instead of failing deep inside a stream. */
  private requireKeys(needed: ('deepgram' | 'translate')[]): boolean {
    const missing = missingKeys(this.cfg).filter((m) => needed.includes(m))
    if (missing.length === 0) return true
    const names = missing.map((m) => (m === 'deepgram' ? 'Deepgram' : this.cfg.translate.provider)).join(' and ')
    this.send({ type: 'error', code: 'no_keys', message: `Missing ${names} key — add it in Settings` })
    return false
  }

  private async runTest() {
    try {
      this.send({ type: 'test_result', results: await testConfig(this.cfg) })
    } catch (err) {
      this.send({ type: 'error', message: `test failed: ${err instanceof Error ? err.message : 'unknown error'}` })
    }
  }

  /** (Re)start the STT stream. Replaces whatever stream was running; the mic itself never stops. */
  private start(mode: StreamMode) {
    this.stt?.abort()
    if (!this.requireKeys(['deepgram', 'translate'])) {
      this.mode = null
      this.stt = null
      return
    }
    this.mode = mode
    this.audioBytes = 0
    this.audioChunks = 0
    this.lastStatBytes = 0
    this.openStt()
  }

  private openStt() {
    const mode = this.mode
    if (!mode) return
    // `talk` is English by definition; in `auto` the STT layer decides the language (see stt.ts / arbiter.ts).
    const stt: Stt = createStt(mode, {
      onPartial: (text, dir) => this.send({ type: 'partial', dir, text }),
      onFinal: (text, dir) => {
        if (tooShort(text)) return
        this.enqueue(dir, text)
      },
      onError: (err) => {
        warn(this.tag, `stt error: ${err.message}`)
        this.send({ type: 'error', message: `speech-to-text: ${err.message}` })
      },
      onClose: () => {
        if (this.stt !== stt || this.mode !== 'auto') return
        this.stt = null
        this.restartAuto()
      },
    }, { deepgramKey: this.cfg.deepgramKey!, engine: this.cfg.listenEngine })
    this.stt = stt
  }

  /** Deepgram dropped the always-on stream; reopen it, but give up if it keeps failing right away. */
  private restartAuto() {
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < 30_000)
    if (this.restarts.length >= 5) {
      warn(this.tag, 'deepgram keeps disconnecting — giving up on always-on listening')
      this.send({ type: 'error', message: 'speech-to-text keeps disconnecting; check the server log' })
      this.mode = null
      return
    }
    this.restarts.push(now)
    warn(this.tag, `deepgram stream dropped — reopening (${this.restarts.length}/5 in 30s)`)
    setTimeout(() => {
      if (this.mode === 'auto' && !this.stt && this.socket.readyState === this.socket.OPEN) this.openStt()
    }, 500)
  }

  private async end() {
    const stt = this.stt
    const mode = this.mode
    this.stt = null
    this.mode = null
    const secs = (this.audioBytes / 32000).toFixed(1) // 16 kHz * 2 bytes
    log(this.tag, `end of ${mode ?? 'idle'} stream: received ${this.audioChunks} audio chunks / ${this.audioBytes} bytes (~${secs}s)`)
    if (mode === 'talk' && this.audioBytes === 0) {
      warn(this.tag, 'no audio arrived from the app — mic permission, audioControl, or the glasses connection is the problem, not the server')
      this.send({ type: 'error', message: 'No audio received from the glasses mic' })
    }
    if (stt) await stt.finish()
    await this.pending
    log(this.tag, '→ done')
    this.send({ type: 'done' })
  }

  private enqueue(dir: Direction, text: string) {
    const id = this.nextId++
    this.pending = this.pending.then(async () => {
      const t0 = Date.now()
      log(this.tag, `translate #${id} (${dir}): "${text}"`)
      try {
        const t = await translate(dir, text, this.history, id, this.cfg.translate)
        this.history.push(t)
        if (this.history.length > 6) this.history.shift()
        log(this.tag, `translate #${id} ok in ${Date.now() - t0}ms → ja="${t.japanese}" romaji="${t.romaji}" en="${t.english}"`)
        this.send({ type: 'final', ...t })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        warn(this.tag, `translate #${id} FAILED after ${Date.now() - t0}ms: ${message}`)
        this.send({ type: 'error', message: `translate: ${message}` })
      }
    })
  }

  private send(msg: ServerMsg) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg))
  }
}

http.listen(PORT, () => {
  log('server', `honyaku server listening on :${PORT} (health: http://localhost:${PORT}/health)`)
  if (serverKeysAllowed()) log('server', 'ALLOW_SERVER_KEYS is on: connections without their own keys use this server\'s .env keys (you will be billed)')
  else log('server', 'users must bring their own API keys (set ALLOW_SERVER_KEYS=1 to fall back to this server\'s .env keys in dev)')
  void runStartupChecks(TOKEN)
})
