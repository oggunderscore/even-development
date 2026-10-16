// The translation engine. It runs inside the app's WebView and calls Deepgram and the user's translation
// provider straight from the phone, with the user's own keys — there is no server.
//
//   handle({config}) → handle({start,mode}) → audio(pcm)… (continuous) → handle({end})?
//   emits: config_ok · partial… · final… · done (after an explicit end) · error · test_result
//
// mode "auto": always-on, English + Japanese (reopened automatically if Deepgram drops).
// mode "talk": wearer holds the button — English only, always translated to Japanese romaji.

import type { ClientMsg, Direction, ServerMsg, StreamMode, Translation, UserConfig } from '../protocol'
import { type ResolvedConfig, missingKeys, resolveConfig, validateConfig } from './config'
import { testConfig } from './probes'
import { type Stt, createStt as defaultCreateStt } from './stt'
import { detectDir, translate } from './translate'

export interface EngineOptions {
  /** Test seam. */
  createStt?: typeof defaultCreateStt
}

/** Ignore recogniser noise like a lone "uh" / "。". */
const tooShort = (text: string) => text.replace(/\s/g, '').length < 2

export class Engine {
  private stt: Stt | null = null
  private mode: StreamMode | null = null
  private cfg: ResolvedConfig
  private history: Translation[] = []
  private nextId = 1
  private audioBytes = 0
  private restarts: number[] = []
  private closed = false
  /** Translations are chained so results reach the glasses in speech order. */
  private pending: Promise<void> = Promise.resolve()

  constructor(
    private readonly emit: (msg: ServerMsg) => void,
    private readonly opts: EngineOptions = {},
  ) {
    this.cfg = resolveConfig({})
  }

  handle(msg: ClientMsg) {
    if (this.closed) return
    switch (msg.type) {
      case 'config':
        this.onConfig(msg.config)
        break
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

  audio(chunk: Uint8Array) {
    if (this.closed) return
    this.audioBytes += chunk.length
    this.stt?.audio(chunk)
  }

  close() {
    this.closed = true
    this.mode = null
    this.stt?.abort()
    this.stt = null
  }

  // ── config / keys ──────────────────────────────────────────────────────────

  private onConfig(user: UserConfig) {
    const problem = validateConfig(user ?? {})
    if (problem) {
      this.emit({ type: 'error', message: problem })
      return
    }
    this.cfg = resolveConfig(user)
    const missing = missingKeys(this.cfg)
    this.emit({
      type: 'config_ok',
      stt: !missing.includes('deepgram'),
      translate: !missing.includes('translate'),
      provider: this.cfg.translate.provider,
    })
  }

  /** Tell the app which key is missing (it opens Settings) instead of failing deep inside a stream. */
  private requireKeys(needed: ('deepgram' | 'translate')[]): boolean {
    const missing = missingKeys(this.cfg).filter((m) => needed.includes(m))
    if (missing.length === 0) return true
    const names = missing.map((m) => (m === 'deepgram' ? 'Deepgram' : this.cfg.translate.provider)).join(' and ')
    this.emit({ type: 'error', code: 'no_keys', message: `Missing ${names} key — add it in Settings` })
    return false
  }

  private async runTest() {
    try {
      this.emit({ type: 'test_result', results: await testConfig(this.cfg) })
    } catch (err) {
      this.emit({ type: 'error', message: `test failed: ${err instanceof Error ? err.message : 'unknown error'}` })
    }
  }

  // ── streaming ──────────────────────────────────────────────────────────────

  /** (Re)start the STT stream. Replaces whatever stream was running; the mic itself never stops. */
  private start(mode: StreamMode) {
    this.stt?.abort()
    this.stt = null
    if (!this.requireKeys(['deepgram', 'translate'])) {
      this.mode = null
      return
    }
    this.mode = mode
    this.audioBytes = 0
    this.openStt()
  }

  private openStt() {
    const mode = this.mode
    if (!mode) return
    const create = this.opts.createStt ?? defaultCreateStt
    // `talk` is English by definition; in `auto` the STT layer decides the language (see stt.ts / arbiter.ts).
    const stt: Stt = create(
      mode,
      {
        onPartial: (text, dir) => this.emit({ type: 'partial', dir, text }),
        onFinal: (text, dir) => {
          if (tooShort(text)) return
          this.enqueue(dir, text)
        },
        onError: (err) => {
          this.emit({ type: 'error', message: `speech-to-text: ${err.message}` })
        },
        onClose: () => {
          if (this.stt !== stt || this.mode !== 'auto') return
          this.stt = null
          this.restartAuto()
        },
      },
      { deepgramKey: this.cfg.deepgramKey! },
    )
    this.stt = stt
  }

  /** Deepgram dropped the always-on stream; reopen it, but give up if it keeps failing right away. */
  private restartAuto() {
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < 30_000)
    if (this.restarts.length >= 5) {
      this.emit({ type: 'error', message: 'speech-to-text keeps disconnecting; check your Deepgram key and network' })
      this.mode = null
      return
    }
    this.restarts.push(now)
    setTimeout(() => {
      if (!this.closed && this.mode === 'auto' && !this.stt) this.openStt()
    }, 500)
  }

  private async end() {
    const stt = this.stt
    const mode = this.mode
    this.stt = null
    this.mode = null
    if (mode === 'talk' && this.audioBytes === 0) {
      this.emit({ type: 'error', message: 'No audio received from the glasses mic' })
    }
    if (stt) await stt.finish()
    await this.pending
    this.emit({ type: 'done' })
  }

  private enqueue(dir: Direction, text: string) {
    const id = this.nextId++
    this.pending = this.pending.then(async () => {
      try {
        const t = await translate(dir, text, this.history, id, this.cfg.translate)
        this.history.push(t)
        if (this.history.length > 6) this.history.shift()
        this.emit({ type: 'final', ...t })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emit({ type: 'error', message: `translate: ${message}` })
      }
    })
  }
}
