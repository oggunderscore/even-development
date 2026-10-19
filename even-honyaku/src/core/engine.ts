// The translation engine. It runs inside the app's WebView and calls Deepgram and the user's translation
// provider straight from the phone, with the user's own keys — there is no server.
//
//   handle({config}) → handle({start,mode}) → audio(pcm)… (continuous) → handle({end})?
//   emits: config_ok · partial… · final… · predictions · self · voice_score · done (after an explicit end) · error · test_result
//
// mode "auto": always-on, English + Japanese (reopened automatically if Deepgram drops).
// mode "talk": wearer holds the button — English only, always translated to Japanese romaji.
//
// Voice filter (on by default): every final is attributed to the wearer or the other person before anything is done
// with it — see voice.ts / echo.ts. The wearer's own Japanese is never translated or answered.
// Predictive mode: when the other person stops talking, suggest replies (predict.ts).

import type { ClientMsg, Direction, PredictConfig, ReplyOption, ServerMsg, StreamMode, Translation, UserConfig, VoiceProfile } from '../protocol'
import { type ResolvedConfig, missingKeys, resolveConfig, validateConfig } from './config'
import { voiceFeatures } from './dsp'
import { EchoMatcher } from './echo'
import { isBackchannel, predictReplies } from './predict'
import { testConfig } from './probes'
import { type Range, type Stt, createStt as defaultCreateStt } from './stt'
import { detectDir, translate } from './translate'
import {
  ECHO_CERTAIN,
  ECHO_LIKELY,
  VoiceTimeline,
  analyze,
  emptyProfile,
  parseProfile,
  withLearned,
} from './voice'

export interface EngineOptions {
  /** Test seam. */
  createStt?: typeof defaultCreateStt
  /** How long the other person must be quiet before their turn counts as finished (ms). */
  turnGapMs?: number
}

/** Ignore recogniser noise like a lone "uh" / "。". */
const tooShort = (text: string) => text.replace(/\s/g, '').length < 2

const DEFAULT_TURN_GAP_MS = 900
/** A voice vector needs this much clearly-voiced speech before it may teach the voiceprint. */
const MIN_LEARN_SEC = 1.0

export class Engine {
  private stt: Stt | null = null
  private timeline: VoiceTimeline | null = null
  private mode: StreamMode | null = null
  private cfg: ResolvedConfig
  private predict: PredictConfig | null = null
  private voice = { filter: true, strictness: 0.5 }
  private profile: VoiceProfile | null = null
  private profileTimer: ReturnType<typeof setTimeout> | undefined
  private readonly echo = new EchoMatcher()
  private history: Translation[] = []
  private nextId = 1
  private audioBytes = 0
  private restarts: number[] = []
  private closed = false
  /** Translations are chained so results reach the glasses in speech order. */
  private pending: Promise<void> = Promise.resolve()

  /** The other person's current turn: what they said since the wearer last spoke. */
  private turn: { texts: string[]; firstId: number; lastId: number } | null = null
  private turnTimer: ReturnType<typeof setTimeout> | undefined
  private predicting: AbortController | null = null

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
      case 'chose':
        this.wearerSaid(msg.option)
        break
    }
  }

  audio(chunk: Uint8Array) {
    if (this.closed) return
    this.audioBytes += chunk.length
    if (this.stt) {
      this.timeline?.push(chunk)
      this.stt.audio(chunk)
    }
  }

  close() {
    this.closed = true
    this.mode = null
    this.stt?.abort()
    this.stt = null
    this.cancelTurn()
    clearTimeout(this.profileTimer)
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

    const llm = this.cfg.translate.provider !== 'google'
    const wantsPredict = !!user.predict?.enabled
    this.predict = user.predict && wantsPredict && llm ? user.predict : null
    if (!this.predict) this.cancelTurn()
    this.voice = { filter: user.voice?.filter ?? true, strictness: Math.min(1, Math.max(0, user.voice?.strictness ?? 0.5)) }
    if (user.voice && 'profile' in user.voice) this.profile = parseProfile(user.voice.profile)

    this.emit({
      type: 'config_ok',
      stt: !missing.includes('deepgram'),
      translate: !missing.includes('translate'),
      provider: this.cfg.translate.provider,
      predict: this.predict !== null,
    })
    if (wantsPredict && !llm) {
      this.emit({ type: 'error', code: 'no_llm', message: 'Predictive mode needs an OpenRouter or Claude key; Google Translate cannot suggest replies' })
    }
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
    this.restarts = [] // an explicit (re)start earns a fresh reconnect budget
    this.openStt()
  }

  private openStt() {
    const mode = this.mode
    if (!mode) return
    const create = this.opts.createStt ?? defaultCreateStt
    // Each stream has its own clock (Deepgram times start at 0 when it opens), so each gets its own audio timeline.
    const timeline = new VoiceTimeline()
    this.timeline = timeline
    // `talk` is English by definition; in `auto` the STT layer decides the language (see stt.ts / arbiter.ts).
    const stt: Stt = create(
      mode,
      {
        onPartial: (text, dir) => {
          // Half a suggested reply being read aloud is the wearer, not the other person: don't show or count it.
          if (dir === 'listen' && this.voice.filter && (this.echo.match(text, 'ja')?.score ?? 0) >= ECHO_CERTAIN) return
          if (dir === 'listen' && this.turnTimer) this.scheduleTurn() // they are still talking
          this.emit({ type: 'partial', dir, text })
        },
        onFinal: (text, dir, range) => {
          if (tooShort(text)) return
          this.onFinal(text, dir, range, timeline, mode)
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

  // ── who spoke? ─────────────────────────────────────────────────────────────

  /** One recognised utterance: decide whose it is, then translate it, ignore it, or learn from it. */
  private onFinal(text: string, dir: Direction, range: Range | undefined, timeline: VoiceTimeline, mode: StreamMode) {
    const audio = range ? timeline.slice(range.start, range.end) : null

    // Holding the phone button is the one moment we *know* it is the wearer: free training data for the voiceprint.
    if (mode === 'talk') {
      this.learn('en', audio)
      this.cancelTurn()
      this.enqueue('speak', text)
      return
    }
    if (!this.voice.filter) {
      this.enqueue(dir, text)
      return
    }

    const lang = dir === 'listen' ? 'ja' : 'en'
    const echo = this.echo.match(text, lang)
    const { who, voice, level } = analyze(this.profile, audio, this.voice.strictness, echo?.score ?? 0)
    this.emit({ type: 'voice_score', who, text, echo: echo?.score ?? 0, voice, level })

    if (who === 'wearer') {
      const reading = echo && echo.score >= ECHO_LIKELY ? echo : null
      if (dir === 'listen' || reading) {
        // The wearer's own Japanese (usually a suggested reply being read aloud): not part of the conversation.
        this.emit({ type: 'self', text, ...(reading ? { option: reading.option, optionIndex: reading.index } : {}) })
        if (reading) this.wearerSaid(reading.option)
        else this.cancelTurn()
        if (echo && echo.score >= ECHO_CERTAIN) this.learn('ja', audio)
        return
      }
      this.cancelTurn()
      this.enqueue('speak', text) // the wearer speaking free English → romaji, as always
      return
    }

    if (dir === 'listen') {
      this.enqueue('listen', text, { unsure: who === 'unsure' })
      return
    }
    // English text. It is the wearer's free English unless the voice is *clearly* somebody else's.
    const clearlyOther = who === 'other' && voice !== null && voice < 0.15 && (level === null || level < 0.25)
    if (clearlyOther) this.enqueue('listen', text, { heardEnglish: true })
    else {
      this.cancelTurn()
      this.enqueue('speak', text)
    }
  }

  /** Add an utterance we are sure was the wearer's to their voiceprint (kept apart from the enrolled samples). */
  private learn(lang: 'en' | 'ja', audio: Float32Array | null) {
    const f = audio ? voiceFeatures(audio) : null
    if (!f || f.voicedSec < MIN_LEARN_SEC) return
    this.profile = withLearned(this.profile ?? emptyProfile(), lang, f)
    clearTimeout(this.profileTimer)
    this.profileTimer = setTimeout(() => {
      if (!this.closed && this.profile) this.emit({ type: 'voice_profile', profile: this.profile })
    }, 3000)
  }

  /** The wearer said (or picked) one of the suggestions: it joins the conversation history and ends the other's turn. */
  private wearerSaid(option: ReplyOption) {
    const t: Translation = { id: this.nextId++, dir: 'speak', english: option.gloss, japanese: option.ja, romaji: option.romaji }
    this.history.push(t)
    if (this.history.length > 6) this.history.shift()
    this.cancelTurn()
  }

  // ── translation ────────────────────────────────────────────────────────────

  private enqueue(dir: Direction, text: string, flags: { unsure?: boolean; heardEnglish?: boolean } = {}): number {
    const id = this.nextId++
    this.pending = this.pending.then(async () => {
      try {
        const t: Translation = flags.heardEnglish
          ? { id, dir: 'listen', japanese: '', romaji: '', english: text, heardEnglish: true }
          : { ...(await translate(dir, text, this.history, id, this.cfg.translate)), ...(flags.unsure ? { unsure: true } : {}) }
        this.history.push(t)
        if (this.history.length > 6) this.history.shift()
        this.emit({ type: 'final', ...t })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emit({ type: 'error', message: `translate: ${message}` })
      }
    })
    if (dir === 'listen' && !flags.unsure && this.predict) this.addToTurn(text, id)
    return id
  }

  // ── turns and predictions ──────────────────────────────────────────────────

  private addToTurn(text: string, id: number) {
    this.turn = { texts: [...(this.turn?.texts ?? []), text].slice(-3), firstId: this.turn?.firstId ?? id, lastId: id }
    this.scheduleTurn()
  }

  private scheduleTurn() {
    clearTimeout(this.turnTimer)
    this.turnTimer = setTimeout(() => void this.runPrediction(), this.opts.turnGapMs ?? DEFAULT_TURN_GAP_MS)
  }

  /** The wearer is replying (or the mode was switched off): forget the other person's turn and any pending suggestion. */
  private cancelTurn() {
    clearTimeout(this.turnTimer)
    this.turnTimer = undefined
    this.predicting?.abort()
    this.predicting = null
    this.turn = null
  }

  private async runPrediction() {
    this.turnTimer = undefined
    const turn = this.turn
    const predict = this.predict
    if (!turn || !predict || this.closed) return
    const heard = turn.texts.join(' ')
    if (isBackchannel(heard)) {
      this.turn = null
      return
    }
    this.predicting?.abort()
    const ctl = new AbortController()
    this.predicting = ctl
    try {
      // The turn itself is passed as `heard`; history holds only what came before it.
      const history = this.history.filter((h) => h.id < turn.firstId)
      const prediction = await predictReplies(heard, history, this.cfg.translate, predict, ctl.signal)
      if (ctl.signal.aborted || this.closed) return
      this.echo.remember(turn.lastId, prediction.options)
      this.emit({ type: 'predictions', turnId: turn.lastId, prediction })
    } catch (err) {
      if (ctl.signal.aborted || this.closed) return
      this.emit({ type: 'error', message: `reply suggestions: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      if (this.predicting === ctl) this.predicting = null
    }
  }
}
