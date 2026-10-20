// An everyday conversation, start to finish, through the real engine: a café, a payment, asking the way, small talk. The
// "model" answers every call in a different, messy shape (fences, bullets, chatter, CRLF, macrons, JSON...) over a byte
// stream cut at awkward places, on both providers; then the same conversation with things going wrong on the way.
// What it proves: whatever the model sends, the wearer sees clean English and plain-ASCII romaji, no parser or provider
// text ever surfaces, and one bad answer never breaks the turns after it. What it cannot prove: how good a real model is
// (live.test.ts runs these lines against real models when you give it keys).

import { toHiragana } from 'wanakana'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PredictiveView, BODY_ROWS } from './predictive'
import type { ServerMsg, Translation, UserConfig } from './protocol'
import { Engine } from './core/engine'
import { stripMacrons } from './core/lang'
import type { SttHandlers } from './core/stt'
import { CONVERSATION, type Exchange, type FakeNetworkOptions, fakeNetwork, splitGloss } from './test/conversation'

const KEYS = { deepgram: 'dg-user-key-123', openrouter: 'or-user-key-123', anthropic: 'sk-ant-user-key-123' }
const PREDICT = { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 } as const

/** Anything that would mean a parser, JSON or provider detail reached a person. */
const LEAK = /[{}[\]"|*`]|ROMAJI|\bJA:|\bEN:|\bsingle\b|\bchoice\b|JSON|position \d|Expected|undefined|openrouter|anthropic|\b(?:4|5)\d\d\b/i

/**
 * `fakeTime`: also fake setTimeout, so a model that goes quiet costs simulated seconds, not real ones. Otherwise only the
 * clock is faked: a pause between exchanges is a jump in time, not a wait.
 */
function start(network: FakeNetworkOptions, config: Partial<UserConfig> = {}, fakeTime = false) {
  vi.useFakeTimers({ toFake: fakeTime ? ['Date', 'setTimeout', 'clearTimeout'] : ['Date'] })
  const net = fakeNetwork(CONVERSATION, network)
  vi.stubGlobal('fetch', vi.fn(net.fetch))
  const out: ServerMsg[] = []
  /** When (on the possibly faked clock) each message in `out` was emitted. */
  const times: number[] = []
  let stt!: SttHandlers
  const engine = new Engine((m) => (out.push(m), times.push(Date.now())), {
    turnGapMs: 20,
    createStt: (_m, h) => {
      stt = h
      return { audio: vi.fn(), finish: vi.fn().mockResolvedValue(undefined), abort: vi.fn() }
    },
  })
  engine.handle({
    type: 'config',
    config: { keys: KEYS, provider: network.provider, predict: PREDICT, ...config },
  })
  engine.handle({ type: 'start', mode: 'auto' })

  let clock = 0
  const say = (text: string, dir: 'listen' | 'speak') => {
    stt.onFinal(text, dir, { start: clock, end: clock + 2 })
    clock += 4
  }
  /** Wait until nothing new has been emitted for a moment (a quiet spell longer than two timed-out attempts, with fake time). */
  const settle = async () => {
    const quiet = fakeTime ? 7500 : 60
    for (let i = 0; i < 100; i++) {
      const n = out.length
      if (fakeTime) await vi.advanceTimersByTimeAsync(quiet)
      else await new Promise((r) => setTimeout(r, quiet))
      if (out.length === n) return
    }
  }
  /** Where each exchange ended in `out`, to look at what the glasses showed at those moments. */
  const boundaries: number[] = []
  const finalPredictions = () => out.filter((m): m is Extract<ServerMsg, { type: 'predictions' }> => m.type === 'predictions' && !m.partial)
  const of = <T extends ServerMsg['type']>(t: T) => out.filter((m) => m.type === t) as Extract<ServerMsg, { type: T }>[]
  return { engine, net, out, times, say, settle, of, finalPredictions, boundaries }
}

type Run = ReturnType<typeof start>

/** Play the whole conversation. Returns, per exchange, what the wearer was shown. */
async function play(run: Run, script: Exchange[] = CONVERSATION) {
  const shown: { finals: Translation[]; predictions: ReturnType<Run['finalPredictions']> }[] = []
  for (const ex of script) {
    vi.setSystemTime(Date.now() + 12_000) // long enough that the engine treats this as a new turn
    const finals0 = run.of('final').length
    const preds0 = run.finalPredictions().length
    for (const phrase of ex.other) run.say(phrase, 'listen')
    await run.settle()
    const finals = run.of('final').slice(finals0)
    const predictions = run.finalPredictions().slice(preds0)

    if (ex.wearer && 'read' in ex.wearer && predictions[0]) {
      const option = predictions[0].prediction.options[ex.wearer.read]!
      run.say(toHiragana(option.romaji), 'listen') // the wearer reads a suggestion aloud
      await run.settle()
    } else if (ex.wearer && 'free' in ex.wearer) {
      run.say(ex.wearer.free, 'speak')
      await run.settle()
    }
    run.boundaries.push(run.out.length)
    shown.push({ finals, predictions })
  }
  return shown
}

/** Everything a person could see in one engine message. */
function visibleText(m: ServerMsg): string[] {
  if (m.type === 'final') return [m.english, m.romaji]
  if (m.type === 'predictions') return m.prediction.options.flatMap((o) => [o.gloss, o.romaji, o.ja])
  if (m.type === 'error') return [m.message]
  return []
}

const asciiRomaji = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

function expectCleanConversation(run: Run, opts: { predictive: boolean; romajiForOther: boolean }) {
  expect(run.of('error')).toEqual([])

  for (const m of run.out) for (const text of visibleText(m)) expect(text, JSON.stringify(m)).not.toMatch(LEAK)
  for (const m of run.of('final')) expect(m.romaji).toMatch(/^[\x20-\x7e]*$/) // plain ASCII: the glasses font drops anything else

  // What the other person said arrives as English, phrase by phrase, matching the script.
  const listens = run.of('final').filter((m) => m.dir === 'listen' && !m.heardEnglish)
  const phrases = CONVERSATION.flatMap((e) => e.other.map((p) => ({ e, p })))
  expect(listens.map((m) => m.japanese)).toEqual(phrases.map((x) => x.p))
  for (const [i, { e, p }] of phrases.entries()) {
    const { english, romaji } = splitGloss(e, p)
    expect(listens[i]!.english).toBe(english)
    expect(asciiRomaji(listens[i]!.romaji)).toBe(opts.romajiForOther ? asciiRomaji(romaji) : '')
  }

  // The wearer's own English becomes Japanese plus romaji to read aloud.
  const speaks = run.of('final').filter((m) => m.dir === 'speak')
  const free = CONVERSATION.flatMap((e) => (e.wearer && 'free' in e.wearer ? [e.wearer] : []))
  expect(speaks.map((m) => [m.english, m.japanese, m.romaji])).toEqual(free.map((w) => [w.free, w.ja, w.romaji]))

  if (!opts.predictive) {
    expect(run.finalPredictions()).toEqual([])
    return
  }

  // Replies: one set per real question, none for "はい。", clean, short, and the right kind.
  const wanted = CONVERSATION.filter((e) => e.replies)
  expect(run.finalPredictions()).toHaveLength(wanted.length)
  for (const [i, p] of run.finalPredictions().entries()) {
    const want = wanted[i]!.replies!
    expect(p.prediction.kind).toBe(want.kind)
    expect(p.prediction.options.map((o) => [o.gloss.toLowerCase(), asciiRomaji(o.romaji)])).toEqual(want.options.map(([g, r]) => [g.toLowerCase(), asciiRomaji(stripMacrons(r))]))
    for (const o of p.prediction.options) {
      expect(o.romaji).toMatch(/^[\x20-\x7e]+$/)
      expect(o.romaji.length).toBeLessThanOrEqual(56)
      expect(o.gloss.length).toBeLessThanOrEqual(28)
      expect(o.ja).toMatch(/[ぁ-ん]/) // kana derived from the romaji
    }
    expect(p.ms).toBeGreaterThanOrEqual(0)
  }

  // Replies the wearer read aloud were recognised and kept out of the conversation (no translation, no new question).
  const reads = CONVERSATION.filter((e) => e.wearer && 'read' in e.wearer)
  expect(run.of('self')).toHaveLength(reads.length)
  expect(run.of('self')[0]!.optionIndex).toBe(1)
}

/** What the glasses would draw for the whole conversation: every screen fits and is clean. */
function expectGlassesScreensFit(run: Run) {
  const view = new PredictiveView({ kana: false })
  const check = () => {
    const rows = view.rows()
    expect(rows.length).toBeLessThanOrEqual(BODY_ROWS)
    for (const row of rows) expect(row).not.toMatch(/[{}[\]"|*`]/)
  }
  const error = new Set(run.out.flatMap((m, i) => (m.type === 'error' && m.ref?.startsWith('R-') ? [i] : [])))
  for (const [i, m] of run.out.entries()) {
    if (m.type === 'final') view.heard(m, m.dir === 'listen' && !m.unsure)
    else if (m.type === 'predictions') view.predictions(m.turnId, m.prediction)
    else if (m.type === 'no_predictions') view.skipped(m.turnId)
    else if (m.type === 'self') view.said(m.optionIndex ?? -1, m.turnId)
    else if (error.has(i)) view.failed((m as Extract<ServerMsg, { type: 'error' }>).message)
    else {
      if (run.boundaries.includes(i + 1)) expect(view.rows().join('\n'), 'still thinking when the exchange ended').not.toMatch(/thinking/)
      continue
    }
    check()
    // When an exchange is over the glasses must not be left waiting for suggestions.
    if (run.boundaries.includes(i + 1)) expect(view.rows().join('\n'), 'still thinking when the exchange ended').not.toMatch(/thinking/)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('an everyday conversation, start to finish', () => {
  it('OpenRouter, Predictive mode: every answer shape, streamed in awkward pieces', async () => {
    const run = start({ provider: 'openrouter' })
    await play(run)
    expectCleanConversation(run, { predictive: true, romajiForOther: false })
    expectGlassesScreensFit(run)
    // the model really did receive varied requests: replies streamed, translations not, reasoning off, no JSON mode
    const replies = run.net.calls.filter((c) => c.kind === 'replies')
    expect(replies.length).toBe(CONVERSATION.filter((e) => e.replies).length)
    expect(replies.every((c) => c.body['stream'] === true && c.body['response_format'] === undefined)).toBe(true)
    expect(run.net.calls.filter((c) => c.kind === 'translate').every((c) => c.body['stream'] === false)).toBe(true)
    run.engine.close()
  })

  it('direct Claude, Predictive mode: SSE with CRLF line ends and ping events', async () => {
    const run = start({ provider: 'anthropic' })
    await play(run)
    expectCleanConversation(run, { predictive: true, romajiForOther: false })
    expectGlassesScreensFit(run)
    expect(run.net.calls[0]!.body).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } })
    run.engine.close()
  })

  it('Standard mode (no replies): the other person comes with romaji too', async () => {
    const run = start({ provider: 'openrouter' }, { predict: { ...PREDICT, enabled: false } })
    await play(run)
    expectCleanConversation(run, { predictive: false, romajiForOther: true })
    expect(run.net.calls.every((c) => c.kind === 'translate')).toBe(true)
    run.engine.close()
  })

  it('every model-output shape in the fixture is exercised', () => {
    // 7 translation shapes and 8 reply shapes rotate with the call number; the conversation makes enough calls to hit each.
    const translateCalls = CONVERSATION.reduce((n, e) => n + e.other.length + (e.wearer && 'free' in e.wearer ? 1 : 0), 0)
    const replyCalls = CONVERSATION.filter((e) => e.replies).length
    expect(translateCalls).toBeGreaterThanOrEqual(7)
    expect(replyCalls).toBeGreaterThanOrEqual(8)
  })
})

describe('the same conversation with things going wrong', () => {
  it('rate limits, a bad gateway, a dropped connection and an unusable answer: coded generic errors, and the talk carries on', async () => {
    const run = start({
      provider: 'openrouter',
      // A rate limit is not retried. A 502 or a dropped connection is retried once, so it takes two in a row to give up; a
      // single one (call 9) recovers by itself.
      flaws: { replies: { 1: 'rate_limit', 3: 'html_502', 4: 'html_502', 6: 'cut_stream', 7: 'cut_stream', 9: 'html_502' }, translate: { 4: 'garbage' } },
    })
    await play(run)

    const errors = run.of('error')
    expect(errors.map((e) => e.ref).sort()).toEqual(['R-NET', 'R-RATE', 'R-SVC', 'T-FORM'])
    for (const e of errors) {
      expect(e.message).toMatch(/^(Replies|Translation): [a-z ,]+ \([RT]-[A-Z]+\)$/)
      expect(e.message).not.toMatch(LEAK)
      expect(e.detail).not.toMatch(/ホット|slow down|Bad Gateway|oops|sorry/) // nothing the model or provider said
    }
    expect(errors.find((e) => e.ref === 'R-RATE')!.detail).toBe('openrouter 429 rate_limit_error model=google/gemini-3.1-flash-lite')

    // Everything that did not fail still arrived, including the last exchange after every failure.
    const wanted = CONVERSATION.filter((e) => e.replies).length
    expect(run.finalPredictions().length).toBe(wanted - 3) // the three failed calls; the dropped connection still showed its first reply as a partial
    const last = run.finalPredictions().at(-1)!
    expect(last.prediction.options[0]!.romaji).toBe('arigatou gozaimasu')
    expect(run.of('final').filter((m) => m.dir === 'listen').length).toBe(CONVERSATION.flatMap((e) => e.other).length - 1)
    expect(run.out.filter((m) => m.type === 'predictions' && m.partial).length).toBeGreaterThan(0)
    for (const m of run.out) for (const text of visibleText(m)) expect(text).not.toMatch(/[{}[\]"|*`]|JSON|oops/)
    expectGlassesScreensFit(run)
    run.engine.close()
  })

  it('nothing but failures: every error is coded, the app stays usable', async () => {
    const run = start({ provider: 'anthropic', flaws: { replies: Object.fromEntries(CONVERSATION.map((_, i) => [i, 'garbage'])), translate: { 0: 'rate_limit' } } })
    await play(run)
    expect(run.of('error').length).toBeGreaterThan(5)
    for (const e of run.of('error')) expect(e.message).toMatch(/\([TR]-[A-Z]+\)$/)
    expect(run.of('error').some((e) => e.ref === 'T-RATE')).toBe(true)
    // and a clean answer afterwards still works
    run.say('お会計をお願いします。', 'listen')
    await run.settle()
    expect(run.of('final').at(-1)!.japanese).toBe('お会計をお願いします。')
    run.engine.close()
  })
})

describe('when the model goes quiet (3 seconds, then one retry)', () => {
  it('a call that hangs is retried once and the conversation never waits more than about 7 seconds', async () => {
    const run = start(
      {
        provider: 'openrouter',
        // reply calls: 1 hangs once (the retry, call 2, answers); 4 and 5 are both attempts of one turn and both hang;
        // 7 stalls mid-stream (the retry answers). Translation call 0 hangs once.
        flaws: { replies: { 1: 'hang', 4: 'hang', 5: 'hang', 7: 'stall' }, translate: { 0: 'hang' } },
      },
      {},
      true,
    )
    await play(run)

    // Exactly one reply set was given up on, and the wearer was told with a code, not left on "thinking...".
    expect(run.of('error').map((e) => e.ref)).toEqual(['R-TIME'])
    expect(run.of('error')[0]!.message).toBe('Replies: too slow (R-TIME)')
    const wanted = CONVERSATION.filter((e) => e.replies).length
    expect(run.finalPredictions()).toHaveLength(wanted - 1)
    // Every phrase was still translated (the hung translation was retried).
    expect(run.of('final').filter((m) => m.dir === 'listen')).toHaveLength(CONVERSATION.flatMap((e) => e.other).length)
    expectGlassesScreensFit(run)

    // The retries really happened.
    const replyCalls = run.net.calls.filter((c) => c.kind === 'replies').length
    expect(replyCalls).toBe(wanted + 3) // one extra attempt each for the hang that recovered, the stall that recovered, and the turn given up on
    run.engine.close()
  })

  it('a reply stream that starts and then stalls is abandoned after 3 seconds of silence and asked for again', async () => {
    const run = start({ provider: 'openrouter', flaws: { replies: { 0: 'stall' } } }, {}, true)
    run.say(CONVERSATION[1]!.other[0]!, 'listen')
    await run.settle()
    expect(run.of('error')).toEqual([]) // the retry answered
    expect(run.finalPredictions()).toHaveLength(1)
    run.engine.close()
  })

  it('all attempts quiet: one coded error, and the next phrase works', async () => {
    const run = start({ provider: 'openrouter', flaws: { replies: { 0: 'hang', 1: 'hang' } } }, {}, true)
    const said = Date.now()
    run.say(CONVERSATION[1]!.other[0]!, 'listen')
    await run.settle()
    expect(run.of('error').map((e) => e.ref)).toEqual(['R-TIME'])
    // two attempts of 3 seconds each (plus the short pause before asking): the wearer is never left waiting longer than that
    const waited = run.times[run.out.findIndex((m) => m.type === 'error')]! - said
    expect(waited).toBeGreaterThanOrEqual(6000)
    expect(waited).toBeLessThan(6500)
    expect(run.finalPredictions()).toHaveLength(0)
    vi.setSystemTime(Date.now() + 12_000)
    run.say(CONVERSATION[2]!.other[0]!, 'listen')
    await run.settle()
    expect(run.finalPredictions()).toHaveLength(1)
    expect(run.finalPredictions()[0]!.prediction.options[0]!.romaji).toBe('hotto de onegaishimasu')
    run.engine.close()
  })
})
