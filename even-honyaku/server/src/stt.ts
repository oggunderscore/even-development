// Deepgram live transcription.
//
//   createStt('talk', …)  – the wearer holding the phone button: one `en` stream, always English → romaji.
//   createStt('auto', …)  – always-on listening. LISTEN_ENGINE picks how:
//        dual  (default)  – a dedicated `ja` stream AND a dedicated `en` stream on the same audio, arbitrated
//                           with a bias towards Japanese (see arbiter.ts). Most reliable; 2× Deepgram audio cost.
//        ja               – Japanese only. Cheapest; everything heard is treated as Japanese → English.
//        multi            – one `language=multi` stream. Cheapest bilingual option, but it tends to start
//                           Japanese phrases as English text.

import WebSocket from 'ws'
import type { Direction, StreamMode } from '../../src/protocol'
import { Arbiter } from './arbiter'
import { hasJapanese } from './lang'
import { log, warn } from './log'

type Lang = 'ja' | 'en' | 'multi'

export interface Heard {
  confidence: number
  start: number
  end: number
}

/** What the Conn sees, regardless of how many Deepgram sockets are behind it. */
export interface SttHandlers {
  onPartial(text: string, dir: Direction): void
  onFinal(text: string, dir: Direction): void
  onError(err: Error): void
  /** The stream died on its own (not via abort()/finish()) and should be reopened. */
  onClose(): void
}

export interface Stt {
  audio(chunk: Buffer): void
  /** Flush: remaining finals are delivered, then the stream closes. */
  finish(): Promise<void>
  abort(): void
}

interface RawHandlers {
  onPartial(text: string): void
  onFinal(text: string, heard: Heard): void
  onError(err: Error): void
  onClose(): void
}

class DeepgramStream implements Stt {
  private readonly ws: WebSocket
  private readonly opened: Promise<void>
  private queue: Buffer[] = []
  private isOpen = false
  private results = 0
  readonly closed: Promise<void>

  private aborted = false
  private finishing = false
  private keepAlive: ReturnType<typeof setInterval> | undefined

  constructor(private readonly lang: Lang, endpointing: number, private readonly handlers: RawHandlers) {
    const params = new URLSearchParams({
      model: 'nova-3',
      language: lang,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      endpointing: String(endpointing),
      smart_format: 'true',
    })
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${process.env['DEEPGRAM_API_KEY'] ?? ''}` },
    })

    this.opened = new Promise((resolve) => this.ws.once('open', resolve))
    this.ws.once('open', () => {
      log('stt', `deepgram open (${lang}), flushing ${this.queue.length} queued chunks`)
      this.isOpen = true
      for (const chunk of this.queue) this.ws.send(chunk)
      this.queue = []
      // Deepgram drops idle sockets after ~10s; audio normally flows, this covers gaps.
      this.keepAlive = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }, 5000)
    })
    this.ws.on('message', (data) => this.onMessage(data.toString()))
    this.ws.on('error', (err) => {
      const hint = /401/.test(err.message) ? ' — Deepgram rejected DEEPGRAM_API_KEY' : ''
      handlers.onError(new Error(`[${lang}] ${err.message}${hint}`))
    })
    this.closed = new Promise((resolve) =>
      this.ws.once('close', (code, reason) => {
        clearInterval(this.keepAlive)
        log('stt', `deepgram[${lang}] closed (${code}${reason.length ? ` ${reason}` : ''}); ${this.results} result frames`)
        if (!this.aborted && !this.finishing) handlers.onClose()
        resolve()
      }),
    )
  }

  audio(chunk: Buffer) {
    if (this.isOpen) this.ws.send(chunk)
    else this.queue.push(chunk)
  }

  /** Flush: Deepgram emits any remaining finals, then closes the socket. */
  async finish(): Promise<void> {
    this.finishing = true
    await Promise.race([this.opened, this.closed])
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    }
    await this.closed
  }

  abort() {
    this.aborted = true
    clearInterval(this.keepAlive)
    this.ws.terminate()
  }

  private onMessage(raw: string) {
    let msg: {
      type?: string
      is_final?: boolean
      start?: number
      duration?: number
      channel?: { alternatives?: { transcript?: string; confidence?: number }[] }
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'Results') {
      if (msg.type !== 'Metadata' && msg.type !== 'UtteranceEnd' && msg.type !== 'SpeechStarted') warn('stt', `deepgram[${this.lang}] message: ${raw.slice(0, 200)}`)
      return
    }
    this.results++
    const alt = msg.channel?.alternatives?.[0]
    const text = alt?.transcript?.trim() ?? ''
    if (!text) return
    if (msg.is_final) {
      const start = msg.start ?? 0
      const heard: Heard = { confidence: alt?.confidence ?? 0, start, end: start + (msg.duration ?? 0) }
      log('stt', `final[${this.lang}]: "${text}" (conf ${heard.confidence.toFixed(2)}, ${heard.start.toFixed(1)}–${heard.end.toFixed(1)}s)`)
      this.handlers.onFinal(text, heard)
    } else this.handlers.onPartial(text)
  }
}

// ── Always-on, two dedicated streams ─────────────────────────────────────────

class DualStt implements Stt {
  private readonly ja: DeepgramStream
  private readonly en: DeepgramStream
  private readonly arbiter: Arbiter
  private lastJapanese = 0
  private dead = false

  constructor(private readonly handlers: SttHandlers) {
    this.arbiter = new Arbiter((text, dir) => handlers.onFinal(text, dir))
    const closeBoth = () => {
      if (this.dead) return
      this.dead = true
      this.arbiter.dispose()
      this.ja.abort()
      this.en.abort()
      handlers.onClose()
    }
    this.ja = new DeepgramStream('ja', 300, {
      onPartial: (text) => {
        if (!hasJapanese(text)) return
        this.lastJapanese = Date.now()
        handlers.onPartial(text, 'listen')
      },
      onFinal: (text, heard) => this.arbiter.ja({ text, ...heard }),
      onError: (err) => handlers.onError(err),
      onClose: closeBoth,
    })
    this.en = new DeepgramStream('en', 300, {
      // While Japanese is being heard, English guesses are the English model misreading it.
      onPartial: (text) => {
        if (Date.now() - this.lastJapanese > 1500) handlers.onPartial(text, 'speak')
      },
      onFinal: (text, heard) => this.arbiter.en({ text, ...heard }),
      onError: (err) => handlers.onError(err),
      onClose: closeBoth,
    })
  }

  audio(chunk: Buffer) {
    this.ja.audio(chunk)
    this.en.audio(chunk)
  }

  async finish() {
    this.dead = true // our own close, not a failure
    await Promise.all([this.ja.finish(), this.en.finish()])
    this.arbiter.flush()
  }

  abort() {
    this.dead = true
    this.arbiter.dispose()
    this.ja.abort()
    this.en.abort()
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function listenEngine(): 'dual' | 'ja' | 'multi' {
  const v = process.env['LISTEN_ENGINE']
  return v === 'ja' || v === 'multi' ? v : 'dual'
}

export function createStt(mode: StreamMode, handlers: SttHandlers): Stt {
  if (mode === 'talk') {
    return new DeepgramStream('en', 400, {
      onPartial: (text) => handlers.onPartial(text, 'speak'),
      onFinal: (text) => handlers.onFinal(text, 'speak'),
      onError: handlers.onError,
      onClose: handlers.onClose,
    })
  }
  switch (listenEngine()) {
    case 'ja':
      return new DeepgramStream('ja', 300, {
        onPartial: (text) => handlers.onPartial(text, 'listen'),
        onFinal: (text) => handlers.onFinal(text, 'listen'),
        onError: handlers.onError,
        onClose: handlers.onClose,
      })
    case 'multi':
      return new DeepgramStream('multi', 300, {
        onPartial: (text) => handlers.onPartial(text, hasJapanese(text) ? 'listen' : 'speak'),
        onFinal: (text) => handlers.onFinal(text, hasJapanese(text) ? 'listen' : 'speak'),
        onError: handlers.onError,
        onClose: handlers.onClose,
      })
    default:
      return new DualStt(handlers)
  }
}
