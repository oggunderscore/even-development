import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_DEFAULT_MODEL, parseJson, stripMacrons, translate } from './translate'

describe('stripMacrons', () => {
  it('doubles long vowels so the G2 font never drops a glyph', () => {
    expect(stripMacrons('arigatō')).toBe('arigatou')
    expect(stripMacrons('kyūkō')).toBe('kyuukou')
    expect(stripMacrons('Ōsaka')).toBe('Ousaka')
    expect(stripMacrons('onēsan')).toBe('oneesan')
  })
  it('leaves plain ASCII alone', () => {
    expect(stripMacrons('kore wa ikura desu ka?')).toBe('kore wa ikura desu ka?')
  })
  it('output is ASCII-only', () => {
    expect(stripMacrons('Tōkyō é ñ')).toMatch(/^[\x20-\x7e]*$/)
  })
})

describe('parseJson', () => {
  it('parses bare JSON', () => {
    expect(parseJson('{"ja":"こんにちは","romaji":"konnichiwa"}')).toEqual({ ja: 'こんにちは', romaji: 'konnichiwa' })
  })
  it('tolerates code fences and chatter around the object', () => {
    expect(parseJson('Sure!\n```json\n{"en":"hi","romaji":"yaa"}\n```')).toEqual({ en: 'hi', romaji: 'yaa' })
  })
  it('throws when there is no object', () => {
    expect(() => parseJson('no json here')).toThrow(/no JSON/)
  })
})

describe('translate via OpenRouter (mocked fetch)', () => {
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

  beforeEach(() => {
    vi.stubEnv('TRANSLATE_PROVIDER', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
    vi.stubEnv('OPENROUTER_MODEL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('speak: sends a JSON-mode request and returns macron-free romaji', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ja":"ありがとう","romaji":"arigatō"}'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('speak', 'Thank you', [], 7)

    expect(t).toEqual({ id: 7, dir: 'speak', english: 'Thank you', japanese: 'ありがとう', romaji: 'arigatou' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-or-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODEL)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[1].content).toContain('Mode "speak"')
  })

  it('listen: maps {en, romaji} and honours OPENROUTER_MODEL', async () => {
    vi.stubEnv('OPENROUTER_MODEL', 'qwen/qwen3.7-flash')
    const fetchMock = vi.fn().mockResolvedValue(reply('{"en":"How much is this?","romaji":"kore wa ikura desu ka"}'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('listen', 'これはいくらですか？')

    expect(t.english).toBe('How much is this?')
    expect(t.japanese).toBe('これはいくらですか？')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe('qwen/qwen3.7-flash')
  })

  it('throws a readable error on HTTP failure, error bodies and missing key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 402 })))
    await expect(translate('speak', 'hi')).rejects.toThrow(/openrouter 402/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'upstream down' } }))))
    await expect(translate('speak', 'hi')).rejects.toThrow(/upstream down/)

    vi.stubEnv('OPENROUTER_API_KEY', '')
    await expect(translate('speak', 'hi')).rejects.toThrow(/OPENROUTER_API_KEY/)
  })
})
