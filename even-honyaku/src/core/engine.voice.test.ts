import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg, UserConfig, VoiceProfile } from '../protocol'
import { OTHER, WEARER, synthVoice, toPcm } from '../test/synth'
import { voiceFeatures } from './dsp'
import { Engine } from './engine'
import type { SttHandlers } from './stt'
import { emptyProfile, withSeed } from './voice'

const keys = { deepgram: 'dg-user-key-123', openrouter: 'or-user-key-123' }
const json = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })

const QUESTION = 'ホットですか、アイスですか。'
const OPTIONS = {
  kind: 'choice',
  options: [
    { gloss: 'Hot, please', ja: 'ホットでお願いします。', romaji: 'hotto de onegaishimasu.' },
    { gloss: 'Iced, please', ja: 'アイスでお願いします。', romaji: 'aisu de onegaishimasu.' },
  ],
}

/** LLM stand-in: translations for translate calls, option lists for the reply assistant. */
function llm() {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const system: string = body.messages[0].content
    if (system.includes('reply assistant')) return Promise.resolve(json(OPTIONS))
    const user: string = body.messages[1].content
    return Promise.resolve(user.includes('Mode "listen"') ? json({ en: 'Hot or iced?', romaji: 'hotto desu ka, aisu desu ka' }) : json({ ja: 'こんにちは', romaji: 'konnichiwa' }))
  })
}

function setup(config: UserConfig = {}) {
  const out: ServerMsg[] = []
  let handlers!: SttHandlers
  const engine = new Engine((m) => out.push(m), {
    turnGapMs: 20,
    createStt: (_m, h) => {
      handlers = h
      return { audio: vi.fn(), finish: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }
    },
  })
  engine.handle({ type: 'config', config: { keys, provider: 'openrouter', predict: { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 }, ...config } })
  engine.handle({ type: 'start', mode: 'auto' })
  const types = () => out.map((m) => m.type)
  const of = <T extends ServerMsg['type']>(t: T) => out.filter((m) => m.type === t) as Extract<ServerMsg, { type: T }>[]
  /** Feed `seconds` of a voice into the engine and return the stream-time range it occupies. */
  const speak = (x: Float32Array) => {
    const start = (engine as unknown as { timeline: { seconds: number } }).timeline.seconds
    const pcm = toPcm(x)
    for (let at = 0; at < pcm.length; at += 3200) engine.audio(pcm.subarray(at, at + 3200))
    return { start, end: start + x.length / 16000 }
  }
  return { engine, out, types, of, speak, h: () => handlers }
}

function enrolledProfile(): VoiceProfile {
  let p = emptyProfile()
  for (let i = 1; i <= 4; i++) p = withSeed(p, 'en', voiceFeatures(synthVoice(WEARER, { seed: i }))!)
  for (let i = 5; i <= 8; i++) p = withSeed(p, 'ja', voiceFeatures(synthVoice(WEARER, { seed: i }))!)
  return p
}

const pred0Id = (t: { of: (type: 'predictions') => { turnId: number }[] }) => t.of('predictions')[0]!.turnId

describe('Engine: predictive mode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('translates the other person, then suggests replies once they have been quiet for a moment', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    const final = t.of('final')[0]!
    const pred = t.of('predictions')[0]!
    expect(final).toMatchObject({ dir: 'listen', english: 'Hot or iced?' })
    expect(pred.turnId).toBe(final.id)
    expect(pred.prediction.kind).toBe('choice')
    expect(pred.prediction.options.map((o) => o.gloss)).toEqual(['Hot, please', 'Iced, please'])
    t.engine.close()
  })

  it('merges a turn that arrives in pieces into one prediction', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal('いらっしゃいませ。', 'listen', { start: 0, end: 1 })
    t.h().onFinal(QUESTION, 'listen', { start: 1.2, end: 3 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    expect(t.of('predictions')).toHaveLength(1)
    const predictCall = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).find((b) => b.messages[0].content.includes('reply assistant'))
    expect(predictCall.messages[1].content).toContain('いらっしゃいませ。 ホットですか')
    t.engine.close()
  })

  it('a question long after the previous unanswered one starts a fresh turn (not merged into it)', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(1))
    const realNow = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 30_000)
    t.h().onFinal('ミルクは入れますか。', 'listen', { start: 40, end: 42 })
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(2))
    const calls = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.messages[0].content.includes('reply assistant'))
    const justSaid: string = calls[1].messages[1].content.split('The other person just said:')[1]
    expect(justSaid).not.toContain('ホットですか') // the old question is context now, not part of this turn
    expect(justSaid).toContain('ミルク')
    vi.restoreAllMocks()
    t.engine.close()
  })

  it('does not answer a bare acknowledgement', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal('はい。', 'listen', { start: 0, end: 1 })
    await vi.waitFor(() => expect(t.types()).toContain('final'))
    await new Promise((r) => setTimeout(r, 80))
    expect(t.types()).not.toContain('predictions')
    t.engine.close()
  })

  it('recognises the wearer reading a suggestion aloud: kept out of the conversation, no new prediction', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    const finalsBefore = t.of('final').length

    t.h().onFinal('アイスでお願いします', 'listen', { start: 5, end: 7 })
    await vi.waitFor(() => expect(t.types()).toContain('self'))
    await new Promise((r) => setTimeout(r, 80))

    const self = t.of('self')[0]!
    expect(self.optionIndex).toBe(1)
    expect(self.turnId).toBe(pred0Id(t))
    expect(self.option?.gloss).toBe('Iced, please')
    expect(t.of('final')).toHaveLength(finalsBefore) // not translated
    expect(t.of('predictions')).toHaveLength(1) // and not answered
    t.engine.close()
  })

  it('a "chose" from the glasses ends the turn and is remembered for context', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    t.engine.handle({ type: 'chose', option: OPTIONS.options[0]! })
    t.h().onFinal('ミルクは入れますか。', 'listen', { start: 8, end: 10 })
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(2))
    const second = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.messages[0].content.includes('reply assistant'))[1]
    expect(second.messages[1].content).toContain('wearer said: Hot, please')
    t.engine.close()
  })

  it('Google Translate cannot suggest replies: say so and stay in plain translation', () => {
    const out: ServerMsg[] = []
    const engine = new Engine((m) => out.push(m))
    engine.handle({ type: 'config', config: { keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-123' }, provider: 'google', predict: { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 } } })
    expect(out[0]).toMatchObject({ type: 'config_ok', predict: false })
    expect(out[1]).toMatchObject({ type: 'error', code: 'no_llm' })
    engine.close()
  })

  it('switching predictive off drops a pending turn', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    t.engine.handle({ type: 'config', config: { keys, provider: 'openrouter' } })
    await new Promise((r) => setTimeout(r, 100))
    expect(t.types()).not.toContain('predictions')
    t.engine.close()
  })
})

describe('Engine: robustness', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a profile enrolled mid-stream still lines up with stream time (audio before it was skipped, not shifted)', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup() // no profile yet
    t.speak(new Float32Array(16000 * 1.2)) // 1.2 s of silence nobody needed
    t.engine.handle({ type: 'config', config: { keys, provider: 'openrouter', voice: { filter: true, strictness: 0.5, profile: enrolledProfile() } } })
    const range = t.speak(synthVoice(WEARER, { seed: 97, seconds: 2.5, levelDb: -22 }))
    expect(range.start).toBeCloseTo(1.2, 1)
    t.h().onFinal('こんにちは、元気ですか', 'listen', range)
    await vi.waitFor(() => expect(t.types()).toContain('self'))
    t.engine.close()
  })

  it('a preference change right after learning keeps the newer voiceprint, and closing flushes it', async () => {
    vi.stubGlobal('fetch', llm())
    const out: ServerMsg[] = []
    let handlers!: SttHandlers
    const engine = new Engine((m) => out.push(m), { createStt: (_m, h) => ((handlers = h), { audio: vi.fn(), finish: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }) })
    const old = enrolledProfile()
    const config = { keys, provider: 'openrouter' as const, voice: { filter: true, strictness: 0.5, profile: old } }
    engine.handle({ type: 'config', config })
    engine.handle({ type: 'start', mode: 'talk' })
    const pcm = toPcm(synthVoice(WEARER, { seed: 98, seconds: 2.5 }))
    for (let at = 0; at < pcm.length; at += 3200) engine.audio(pcm.subarray(at, at + 3200))
    handlers.onFinal('Where is the station', 'speak', { start: 0, end: 2.5 })
    engine.handle({ type: 'config', config }) // the app re-sends its older saved copy
    engine.close() // before the 3 s debounce
    const saved = out.find((m) => m.type === 'voice_profile') as { profile: VoiceProfile } | undefined
    expect(saved?.profile.en.adapt).toHaveLength(1)
  })

  it('warns about Google + Predictive once, not on every reconfigure', () => {
    const out: ServerMsg[] = []
    const engine = new Engine((m) => out.push(m))
    const config = { keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-123' }, provider: 'google' as const, predict: { enabled: true, style: 'polite' as const, level: 'beginner' as const, maxOptions: 3 as const } }
    engine.handle({ type: 'config', config })
    engine.handle({ type: 'config', config })
    engine.handle({ type: 'config', config })
    expect(out.filter((m) => m.type === 'error')).toHaveLength(1)
    engine.close()
  })

  it('zooming a reply and then reading it aloud records one wearer turn, not two', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    t.engine.handle({ type: 'chose', option: OPTIONS.options[0]! }) // tap to zoom
    t.h().onFinal('ホットでお願いします', 'listen', { start: 5, end: 7 }) // …then reads it
    await vi.waitFor(() => expect(t.types()).toContain('self'))
    t.h().onFinal('ミルクは入れますか。', 'listen', { start: 9, end: 11 })
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(2))
    const second = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.messages[0].content.includes('reply assistant'))[1]
    expect(second.messages[1].content.match(/wearer said: Hot, please/g)).toHaveLength(1)
    t.engine.close()
  })

  it('two replies actually read aloud are two history entries; a tap followed by a different pick is one', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal(QUESTION, 'listen', { start: 0, end: 2 })
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    // a tap, then a different tap: one intended reply (the last)
    t.engine.handle({ type: 'chose', option: OPTIONS.options[0]! })
    t.engine.handle({ type: 'chose', option: OPTIONS.options[1]! })
    // then the wearer really reads it, and afterwards really reads another thing
    t.h().onFinal('アイスでお願いします', 'listen', { start: 5, end: 7 })
    await vi.waitFor(() => expect(t.of('self')).toHaveLength(1))
    t.h().onFinal('ホットでお願いします', 'listen', { start: 8, end: 10 })
    await vi.waitFor(() => expect(t.of('self')).toHaveLength(2))
    t.h().onFinal('ミルクは入れますか。', 'listen', { start: 12, end: 14 })
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(2))
    const last = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1].body))).filter((b) => b.messages[0].content.includes('reply assistant')).at(-1)
    const said = [...last.messages[1].content.matchAll(/wearer said: ([^\n]+)/g)].map((m) => m[1])
    expect(said).toEqual(['Iced, please', 'Hot, please'])
    t.engine.close()
  })

  it('a continuation phrase makes the in-flight prediction obsolete: only the answer to the whole turn arrives', async () => {
    let n = 0
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (!body.messages[0].content.includes('reply assistant')) return Promise.resolve(json({ en: 'x', romaji: 'x' }))
      const mine = ++n
      return new Promise((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        setTimeout(() => resolve(json({ kind: 'single', options: [{ gloss: `Answer ${mine}`, ja: 'はい', romaji: `hai ${mine}` }] })), 150)
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const t = setup()
    t.h().onFinal('いらっしゃいませ。', 'listen', { start: 0, end: 1 })
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => JSON.parse(String(c[1].body)).messages[0].content.includes('reply assistant'))).toBe(true))
    t.h().onFinal(QUESTION, 'listen', { start: 1.5, end: 3 }) // arrives while the first prediction is in flight
    await vi.waitFor(() => expect(t.of('predictions')).toHaveLength(1), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 250))
    expect(t.of('predictions')).toHaveLength(1)
    expect(t.of('predictions')[0]!.turnId).toBe(t.of('final').at(-1)!.id)
    t.engine.close()
  })
})

describe('Engine: voice filter with an enrolled voiceprint', () => {
  afterEach(() => vi.unstubAllGlobals())
  const withProfile = (): UserConfig => ({ voice: { filter: true, strictness: 0.5, profile: enrolledProfile() } })

  it('the wearer speaking Japanese (not a suggestion) is filtered out by voice and level alone', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup(withProfile())
    const range = t.speak(synthVoice(WEARER, { seed: 90, seconds: 2.5, levelDb: -22 }))
    t.h().onFinal('こんにちは、元気ですか', 'listen', range)
    await vi.waitFor(() => expect(t.types()).toContain('self'))
    expect(t.of('self')[0]).toMatchObject({ text: 'こんにちは、元気ですか' })
    expect(t.types()).not.toContain('final')
    expect(t.of('voice_score')[0]).toMatchObject({ who: 'wearer' })
    t.engine.close()
  })

  it('a different, quieter voice is the other person: translated and answered', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup(withProfile())
    const range = t.speak(synthVoice(OTHER, { seed: 91, seconds: 2.5, levelDb: -38 }))
    t.h().onFinal(QUESTION, 'listen', range)
    await vi.waitFor(() => expect(t.types()).toContain('predictions'))
    expect(t.of('voice_score')[0]).toMatchObject({ who: 'other' })
    expect(t.of('final')[0]).toMatchObject({ dir: 'listen' })
    expect(t.of('self')).toHaveLength(0)
    t.engine.close()
  })

  it('the other person speaking English is shown as heard English, not turned into romaji', async () => {
    const fetchMock = llm()
    vi.stubGlobal('fetch', fetchMock)
    const t = setup(withProfile())
    const range = t.speak(synthVoice(OTHER, { seed: 92, seconds: 2.5, levelDb: -40 }))
    t.h().onFinal('Okay, thank you', 'speak', range)
    await vi.waitFor(() => expect(t.types()).toContain('final'))
    expect(t.of('final')[0]).toMatchObject({ dir: 'listen', heardEnglish: true, english: 'Okay, thank you' })
    const translateCalls = fetchMock.mock.calls.filter((c) => !JSON.parse(String(c[1].body)).messages[0].content.includes('reply assistant'))
    expect(translateCalls).toHaveLength(0)
    t.engine.close()
  })

  it('the wearer speaking free English still becomes romaji', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup(withProfile())
    const range = t.speak(synthVoice(WEARER, { seed: 93, seconds: 2.5, levelDb: -22 }))
    t.h().onFinal('Hello, nice to meet you', 'speak', range)
    await vi.waitFor(() => expect(t.types()).toContain('final'))
    expect(t.of('final')[0]).toMatchObject({ dir: 'speak', romaji: 'konnichiwa' })
    t.engine.close()
  })

  it('with the filter off nothing is classified and everything is translated as before', async () => {
    vi.stubGlobal('fetch', llm())
    const t = setup({ voice: { filter: false, strictness: 0.5, profile: enrolledProfile() } })
    const range = t.speak(synthVoice(WEARER, { seed: 94, seconds: 2.5, levelDb: -22 }))
    t.h().onFinal(QUESTION, 'listen', range)
    await vi.waitFor(() => expect(t.types()).toContain('final'))
    expect(t.of('voice_score')).toHaveLength(0)
    expect(t.of('self')).toHaveLength(0)
    t.engine.close()
  })

  it('without an enrolled profile nothing is ever learned: no voiceprint appears unasked', async () => {
    vi.stubGlobal('fetch', llm())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const out: ServerMsg[] = []
      let handlers!: SttHandlers
      const engine = new Engine((m) => out.push(m), { createStt: (_m, h) => ((handlers = h), { audio: vi.fn(), finish: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }) })
      engine.handle({ type: 'config', config: { keys, provider: 'openrouter' } })
      engine.handle({ type: 'start', mode: 'talk' })
      const pcm = toPcm(synthVoice(WEARER, { seed: 96, seconds: 2.5 }))
      for (let at = 0; at < pcm.length; at += 3200) engine.audio(pcm.subarray(at, at + 3200))
      handlers.onFinal('Where is the station', 'speak', { start: 0, end: 2.5 })
      await vi.advanceTimersByTimeAsync(4000)
      expect(out.some((m) => m.type === 'voice_profile')).toBe(false)
      engine.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hold-to-talk teaches the voiceprint (debounced), and is always translated as the wearer', async () => {
    vi.stubGlobal('fetch', llm())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const out: ServerMsg[] = []
      let handlers!: SttHandlers
      const engine = new Engine((m) => out.push(m), { createStt: (_m, h) => ((handlers = h), { audio: vi.fn(), finish: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }) })
      engine.handle({ type: 'config', config: { keys, provider: 'openrouter', voice: { filter: true, strictness: 0.5, profile: enrolledProfile() } } })
      engine.handle({ type: 'start', mode: 'talk' })
      const pcm = toPcm(synthVoice(WEARER, { seed: 95, seconds: 2.5 }))
      for (let at = 0; at < pcm.length; at += 3200) engine.audio(pcm.subarray(at, at + 3200))
      handlers.onFinal('Where is the station', 'speak', { start: 0, end: 2.5 })
      await vi.advanceTimersByTimeAsync(3100)
      const saved = out.find((m) => m.type === 'voice_profile')
      expect(saved).toBeDefined()
      expect((saved as { profile: VoiceProfile }).profile.en.adapt).toHaveLength(1)
      engine.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
