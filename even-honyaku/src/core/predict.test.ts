import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PredictConfig, Translation } from '../protocol'
import { MAX_GLOSS, buildSystem, isBackchannel, parsePrediction, predictReplies } from './predict'
import type { TranslateConfig } from './translate'

const cfg: PredictConfig = { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 }

describe('parsePrediction', () => {
  it('a decision question gives several options, capped at the configured number', () => {
    const p = parsePrediction(
      JSON.stringify({
        kind: 'choice',
        options: [
          { gloss: 'Yes, please', ja: 'はい、お願いします。', romaji: 'hai, onegaishimasu.' },
          { gloss: 'No, thank you', ja: 'いいえ、大丈夫です。', romaji: 'iie, daijoubu desu.' },
          { gloss: 'Maybe later', ja: 'あとで。', romaji: 'atode.' },
          { gloss: 'Fourth', ja: '四', romaji: 'yon' },
        ],
      }),
      3,
    )
    expect(p.kind).toBe('choice')
    expect(p.options.map((o) => o.gloss)).toEqual(['Yes, please', 'No, thank you', 'Maybe later'])
  })

  it('a statement gets exactly one reply even if the model offered more', () => {
    const p = parsePrediction('{"kind":"single","options":[{"gloss":"Thanks","ja":"ありがとう","romaji":"arigatou"},{"gloss":"x","ja":"y","romaji":"zzz"}]}', 3)
    expect(p).toEqual({ kind: 'single', options: [{ gloss: 'Thanks', ja: 'ありがとう', romaji: 'arigatou' }] })
  })

  it('cleans the romaji for the glasses: macrons doubled, ASCII only, spaces collapsed', () => {
    const p = parsePrediction('{"kind":"single","options":[{"gloss":"Thanks","ja":"ありがとう","romaji":"arigatō   gozaimasu…"}]}', 3)
    expect(p.options[0]!.romaji).toBe('arigatou gozaimasu')
  })

  it('drops duplicates, empty and over-long replies, and trims long glosses', () => {
    const long = 'x'.repeat(80)
    const p = parsePrediction(
      JSON.stringify({
        kind: 'choice',
        options: [
          { gloss: 'A very long description of the reply that cannot fit on one row', ja: 'はい', romaji: 'hai' },
          { gloss: 'Same', ja: 'はい。', romaji: 'Hai!' },
          { gloss: 'Empty', ja: '', romaji: 'nothing' },
          { gloss: 'Too long', ja: 'ながい', romaji: long },
          { gloss: 'No', ja: 'いいえ', romaji: 'iie' },
        ],
      }),
      3,
    )
    expect(p.options.map((o) => o.romaji)).toEqual(['hai', 'iie'])
    expect(p.options[0]!.gloss.length).toBeLessThanOrEqual(MAX_GLOSS)
  })

  it('a "choice" with a single usable option degrades to single; nothing usable throws', () => {
    expect(parsePrediction('{"kind":"choice","options":[{"gloss":"Yes","ja":"はい","romaji":"hai"}]}', 3).kind).toBe('single')
    expect(() => parsePrediction('{"kind":"single","options":[]}', 3)).toThrow(/no usable/)
    expect(() => parsePrediction('sorry, no', 3)).toThrow(/no JSON/)
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
    expect(s).toContain('2 to 2 options')
  })
})

describe('predictReplies (mocked fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const tcfg: TranslateConfig = { provider: 'openrouter', openrouterKey: 'sk-or-test' }
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

  it('sends what was heard plus recent turns, and returns the validated options', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"kind":"choice","options":[{"gloss":"Hot","ja":"ホット","romaji":"hotto"},{"gloss":"Iced","ja":"アイス","romaji":"aisu"}]}'))
    vi.stubGlobal('fetch', fetchMock)
    const history: Translation[] = [{ id: 1, dir: 'speak', english: 'A coffee please', japanese: 'コーヒーをください', romaji: 'koohii o kudasai' }]
    const p = await predictReplies('ホットですか、アイスですか', history, tcfg, cfg)
    expect(p.kind).toBe('choice')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.messages[1].content).toContain('A coffee please')
    expect(body.messages[1].content).toContain('ホットですか、アイスですか')
    expect(body.messages[0].content).toContain('reply assistant')
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
    await expect(predictReplies('x', [], { provider: 'google', googleKey: 'g' }, cfg)).rejects.toThrow(/OpenRouter or Claude/)
  })
})
