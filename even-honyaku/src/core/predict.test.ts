import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PredictConfig, Translation } from '../protocol'
import { chatResponse } from '../test/llm'
import { MAX_GLOSS, buildSystem, isBackchannel, parseReplies, predictReplies } from './predict'
import type { TranslateConfig } from './translate'

const cfg: PredictConfig = { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 }

describe('parseReplies', () => {
  it('a decision question gives several options, capped at the configured number', () => {
    const p = parseReplies('choice\nYes, please | hai, onegaishimasu.\nNo, thank you | iie, daijoubu desu.\nMaybe later | atode.\nFourth | yon\n', 3)!
    expect(p.kind).toBe('choice')
    expect(p.options.map((o) => o.gloss)).toEqual(['Yes, please', 'No, thank you', 'Maybe later'])
  })

  it('a statement gets exactly one reply even if the model offered more; the kana is derived from the romaji', () => {
    const p = parseReplies('single\nThanks | arigatou\nx | zzz\n', 3)
    expect(p).toEqual({ kind: 'single', options: [{ gloss: 'Thanks', ja: 'ありがとう', romaji: 'arigatou' }] })
  })

  it('tolerates bullets, numbering, fences, bold and a full-width bar', () => {
    const p = parseReplies('```\n**choice**\n1. Hot | hotto\n- Iced ｜ aisu\n```', 3)!
    expect(p.kind).toBe('choice')
    expect(p.options.map((o) => o.romaji)).toEqual(['hotto', 'aisu'])
  })

  it('cleans the romaji for the glasses: macrons doubled, ASCII only, spaces collapsed', () => {
    const p = parseReplies('single\nThanks | arigatō   gozaimasu…', 3)!
    expect(p.options[0]!.romaji).toBe('arigatou gozaimasu')
  })

  it('drops duplicates, empty and over-long replies, and trims long glosses', () => {
    const p = parseReplies(
      [
        'choice',
        'A very long description of the reply that cannot fit on one row | hai',
        'Same | Hai!',
        'Empty | ',
        `Too long | ${'x'.repeat(80)}`,
        'No | iie',
      ].join('\n'),
      3,
    )!
    expect(p.options.map((o) => o.romaji)).toEqual(['hai', 'iie'])
    expect(p.options[0]!.gloss.length).toBeLessThanOrEqual(MAX_GLOSS)
  })

  it('a "choice" with a single usable option degrades to single; nothing usable is a coded failure, never the text', () => {
    expect(parseReplies('choice\nYes | hai', 3)!.kind).toBe('single')
    expect(() => parseReplies('single', 3)).toThrow(expect.objectContaining({ kind: 'FORM' }))
    expect(() => parseReplies('sorry, I cannot help with that', 3)).toThrow(expect.objectContaining({ kind: 'FORM' }))
  })

  it('malformed JSON-looking output (what used to break replies) is just a coded failure', () => {
    expect(() => parseReplies('{"kind":"single","options":[{"gloss":"a" "ja":"b"]}', 3)).toThrow(expect.objectContaining({ kind: 'FORM' }))
  })

  it('while streaming only complete lines count, and nothing usable yet is null', () => {
    expect(parseReplies('choice\nHot | hot', 3, false)).toBeNull() // the only reply line is unfinished
    const p = parseReplies('choice\nHot | hotto\nIced | ai', 3, false)!
    expect(p).toEqual({ kind: 'choice', options: [expect.objectContaining({ romaji: 'hotto' })] })
  })
})

describe('isBackchannel', () => {
  it('acknowledgements are skipped, real turns are not', () => {
    for (const t of ['はい', 'ええ。', 'うん、うん', 'なるほど', 'あー', 'そうですね。']) expect(isBackchannel(t)).toBe(true)
    for (const t of ['はい、どうぞ', 'お飲み物は何になさいますか', 'いくつですか']) expect(isBackchannel(t)).toBe(false)
  })
})

describe('buildSystem', () => {
  it('carries the style, level and option limit the user chose', () => {
    const s = buildSystem({ ...cfg, style: 'casual', level: 'advanced', maxOptions: 2 })
    expect(s).toContain('Casual')
    expect(s).toContain('advanced')
    expect(s).toContain('2 to 2 reply lines')
  })
})

describe('predictReplies (mocked fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const tcfg: TranslateConfig = { provider: 'openrouter', openrouterKey: 'sk-or-test' }
  const answer = 'choice\nHot | hotto\nIced | aisu\n'

  it('sends what was heard plus recent turns, and returns the validated options', async () => {
    const fetchMock = vi.fn().mockImplementation((_u: string, init: RequestInit) => Promise.resolve(chatResponse(init, answer)))
    vi.stubGlobal('fetch', fetchMock)
    const history: Translation[] = [{ id: 1, dir: 'speak', english: 'A coffee please', japanese: 'コーヒーをください', romaji: 'koohii o kudasai' }]
    const p = await predictReplies('ホットですか、アイスですか', history, tcfg, cfg)
    expect(p.kind).toBe('choice')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.messages[1].content).toContain('A coffee please')
    expect(body.messages[1].content).toContain('ホットですか、アイスですか')
    expect(body.messages[0].content).toContain('Line 1: single')
    expect(body.response_format).toBeUndefined() // no JSON mode: the answer is plain lines
    expect(body.max_tokens).toBeLessThanOrEqual(250) // short answers are what keep it fast
    expect(body.provider).toEqual({ sort: 'latency' })
  })

  it('streams: each option is passed on as soon as its line is complete, before the answer has finished', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => Promise.resolve(chatResponse(init, answer))))
    const seen: string[][] = []
    const p = await predictReplies('ホットですか', [], tcfg, cfg, undefined, (partial) => seen.push(partial.options.map((o) => o.romaji)))
    expect(seen).toEqual([['hotto'], ['hotto', 'aisu']])
    expect(p.options).toHaveLength(2)
  })

  it('a model that answers in the wrong shape gives a coded failure, not its text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => Promise.resolve(chatResponse(init, '{"kind":"single","options":[{"gloss":"a" "ja":"b"'))))
    const err = await predictReplies('こんにちは', [], tcfg, cfg).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'FORM' })
    expect((err as Error).message).not.toMatch(/gloss|json/i)
  })

  it('retries once without routing options if the provider refuses them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":400}}', { status: 400 }))
      .mockImplementation((_u: string, init: RequestInit) => Promise.resolve(chatResponse(init, answer)))
    vi.stubGlobal('fetch', fetchMock)
    await predictReplies('ホットですか', [], tcfg, cfg)
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).provider).toBeUndefined()
  })

  it('passes the abort signal through so a stale prediction can be cancelled', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))))
    vi.stubGlobal('fetch', fetchMock)
    const ctl = new AbortController()
    const run = predictReplies('こんにちは', [], tcfg, cfg, ctl.signal)
    ctl.abort()
    await expect(run).rejects.toThrow('aborted')
  })

  it('Google Translate cannot predict', async () => {
    await expect(predictReplies('x', [], { provider: 'google', googleKey: 'g' }, cfg)).rejects.toMatchObject({ kind: 'UNK' })
  })
})
