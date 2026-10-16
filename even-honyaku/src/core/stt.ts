// Deepgram live transcription over the standard WebSocket API, so the same code runs in Node (server, v22+)
// and in the app's WebView. Auth uses Deepgram's browser-friendly `['token', key]` subprotocol.
//
//   createStt('talk', …)  – the wearer holding the phone button: one `en` stream, always English → romaji.
//   createStt('auto', …)  – always-on listening. The engine picks how:
//        dual  (default)  – a dedicated `ja` stream AND a dedicated `en` stream on the same audio, arbitrated
//                           with a bias towards Japanese (see arbiter.ts). Most reliable; 2× Deepgram audio cost.
//        ja               – Japanese only. Cheapest; everything heard is treated as Japanese → English.
//        multi            – one `language=multi` stream. Cheapest bilingual option, but it tends to start
//                           Japanese phrases as English text.

import type { Direction, ListenEngine, StreamMode } from '../protocol'
import { Arbiter } from './arbiter'
import { hasJapanese } from './lang'

type Lang = 'ja' | 'en' | 'multi'

export interface Heard {
  confidence: number
  start: number
  end: number
}

/** What the engine sees, regardless of how many Deepgram sockets are behind it. */
export interface SttHandlers {
  onPartial(text: string, dir: Direction): void
  onFinal(text: string, dir: Direction): void
  onError(err: Error): void
  /** The stream died on its own (not via abort()/finish()) and should be reopened. */
  onClose(): void
}

export interface Stt {
  audio(chunk: Uint8Array): void
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

const OPEN = 1

/** Deepgram keys are token-safe; anything else can't be a valid WebSocket subprotocol and isn't a real key. */
export const DEEPGRAM_KEY_RE = /^[A-Za-z0-9._~+-]{8,200}$/

export function deepgramUrl(lang: Lang, endpointing = 300): string {
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
  return `wss://api.deepgram.com/v1/listen?${params}`
}

class DeepgramStream implements Stt {
  private ws: WebSocket | null = null
  private queue: Uint8Array[] = []
  private isOpen = false
  private aborted = false
  private finishing = false
  private keepAlive: ReturnType<typeof setInterval> | undefined
  private resolveOpen!: () => void
  private resolveClosed!: () => void
  private readonly opened = new Promise<void>((r) => (this.resolveOpen = r))
  private readonly closed = new Promise<void>((r) => (this.resolveClosed = r))

  constructor(lang: Lang, endpointing: number, apiKey: string, private readonly handlers: RawHandlers) {
    try {
      this.ws = new WebSocket(deepgramUrl(lang, endpointing), ['token', apiKey])
    } catch (err) {
      // e.g. a key containing characters that aren't legal in a subprotocol
      queueMicrotask(() => {
        handlers.onError(new Error(`[${lang}] cannot open Deepgram stream: the key is not valid`))
        this.resolveClosed()
        handlers.onClose()
      })
      return
    }
    const ws = this.ws
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      this.isOpen = true
      for (const chunk of this.queue) ws.send(chunk)
      this.queue = []
      this.resolveOpen()
      // Deepgram drops idle sockets after ~10s; audio normally flows, this covers gaps.
      this.keepAlive = setInterval(() => {
        if (ws.readyState === OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }, 5000)
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.onMessage(e.data)
    }
    ws.onerror = () => {
      // Browsers hide the HTTP status; a socket that never opened almost always means a rejected key.
      const hint = this.isOpen ? 'connection error' : 'could not connect — check the Deepgram API key and network'
      handlers.onError(new Error(`[${lang}] ${hint}`))
    }
    ws.onclose = () => {
      clearInterval(this.keepAlive)
      this.resolveClosed()
      if (!this.aborted && !this.finishing) handlers.onClose()
    }
  }

  audio(chunk: Uint8Array) {
    if (this.isOpen && this.ws) this.ws.send(chunk)
    else this.queue.push(chunk)
  }

  async finish(): Promise<void> {
    this.finishing = true
    if (!this.ws) return
    await Promise.race([this.opened, this.closed])
    if (this.ws.readyState === OPEN) this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    await this.closed
  }

  abort() {
    this.aborted = true
    clearInterval(this.keepAlive)
    try {
      this.ws?.close()
    } catch {
      /* already closed */
    }
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
    if (msg.type !== 'Results') return
    const alt = msg.channel?.alternatives?.[0]
    const text = alt?.transcript?.trim() ?? ''
    if (!text) return
    if (msg.is_final) {
      const start = msg.start ?? 0
      const heard: Heard = { confidence: alt?.confidence ?? 0, start, end: start + (msg.duration ?? 0) }
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

  constructor(apiKey: string, handlers: SttHandlers) {
    this.arbiter = new Arbiter((text, dir) => handlers.onFinal(text, dir))
    const closeBoth = () => {
      if (this.dead) return
      this.dead = true
      this.arbiter.dispose()
      this.ja.abort()
      this.en.abort()
      handlers.onClose()
    }
    this.ja = new DeepgramStream('ja', 300, apiKey, {
      onPartial: (text) => {
        if (!hasJapanese(text)) return
        this.lastJapanese = Date.now()
        handlers.onPartial(text, 'listen')
      },
      onFinal: (text, heard) => this.arbiter.ja({ text, ...heard }),
      onError: (err) => handlers.onError(err),
      onClose: closeBoth,
    })
    this.en = new DeepgramStream('en', 300, apiKey, {
      // While Japanese is being heard, English guesses are the English model misreading it.
      onPartial: (text) => {
        if (Date.now() - this.lastJapanese > 1500) handlers.onPartial(text, 'speak')
      },
      onFinal: (text, heard) => this.arbiter.en({ text, ...heard }),
      onError: (err) => handlers.onError(err),
      onClose: closeBoth,
    })
  }

  audio(chunk: Uint8Array) {
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

export function listenEngine(value: string | undefined): ListenEngine {
  return value === 'ja' || value === 'multi' ? value : 'dual'
}

export interface SttOptions {
  deepgramKey: string
  engine: ListenEngine
}

export function createStt(mode: StreamMode, handlers: SttHandlers, { deepgramKey, engine }: SttOptions): Stt {
  if (mode === 'talk') {
    return new DeepgramStream('en', 400, deepgramKey, {
      onPartial: (text) => handlers.onPartial(text, 'speak'),
      onFinal: (text) => handlers.onFinal(text, 'speak'),
      onError: handlers.onError,
      onClose: handlers.onClose,
    })
  }
  switch (engine) {
    case 'ja':
      return new DeepgramStream('ja', 300, deepgramKey, {
        onPartial: (text) => handlers.onPartial(text, 'listen'),
        onFinal: (text) => handlers.onFinal(text, 'listen'),
        onError: handlers.onError,
        onClose: handlers.onClose,
      })
    case 'multi':
      return new DeepgramStream('multi', 300, deepgramKey, {
        onPartial: (text) => handlers.onPartial(text, hasJapanese(text) ? 'listen' : 'speak'),
        onFinal: (text) => handlers.onFinal(text, hasJapanese(text) ? 'listen' : 'speak'),
        onError: handlers.onError,
        onClose: handlers.onClose,
      })
    default:
      return new DualStt(deepgramKey, handlers)
  }
}
