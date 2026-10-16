// Honyaku proxy: G2 app ⇄ (Deepgram STT) ⇄ LLM (OpenRouter by default). Keeps API keys off the device.
//
//   client → {start,mode} → binary PCM… (continuous)  → {end}?
//   server → partial… → final… → done (after an explicit end)
//
// mode "auto": always-on, English + Japanese detected per utterance (restarted automatically if Deepgram drops).
// mode "talk": wearer holds the button — English only, always translated to Japanese romaji.

import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, Direction, ServerMsg, StreamMode, Translation } from '../../src/protocol'
import { runStartupChecks } from './diagnostics'
import { log, warn } from './log'
import { type Stt, createStt } from './stt'
import { detectDir, translate } from './translate'

const PORT = Number(process.env['PORT'] ?? 8787)
const TOKEN = process.env['HONYAKU_TOKEN'] ?? ''
if (!TOKEN) console.warn('HONYAKU_TOKEN is empty — anyone who can reach this port can spend your API credits.')

const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '')
})
const wss = new WebSocketServer({ server: http })

let nextConn = 1

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const from = `${req.socket.remoteAddress} origin=${req.headers.origin ?? '-'}`
  const sent = url.searchParams.get('token') ?? ''
  if (TOKEN && sent !== TOKEN) {
    warn('conn', `REJECTED ${from}: token mismatch (client sent ${sent ? `${sent.length} chars` : 'nothing'}, server expects ${TOKEN.length} chars). Set VITE_SERVER_TOKEN in .env.local to HONYAKU_TOKEN and restart \`npm run dev\`.`)
    socket.close(4401, 'unauthorized: token mismatch')
    return
  }
  const id = nextConn++
  log('conn', `#${id} open from ${from}`)
  new Conn(socket, id)
})

/** Ignore recogniser noise like a lone "uh" / "。". */
const tooShort = (text: string) => text.replace(/\s/g, '').length < 2

class Conn {
  private stt: Stt | null = null
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
    socket.on('message', (data, isBinary) => {
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
    log(this.tag, `← ${msg.type}${'mode' in msg ? ` mode=${msg.mode}` : ''}${msg.type === 'text' ? ` "${msg.text}"` : ''}`)
    switch (msg.type) {
      case 'start':
        this.start(msg.mode)
        break
      case 'end':
        void this.end()
        break
      case 'text':
        this.enqueue(detectDir(msg.text), msg.text)
        break
    }
  }

  /** (Re)start the STT stream. Replaces whatever stream was running; the mic itself never stops. */
  private start(mode: StreamMode) {
    this.stt?.abort()
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
    })
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
        const t = await translate(dir, text, this.history, id)
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
  void runStartupChecks(TOKEN)
})
