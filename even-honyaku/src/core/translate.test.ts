import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_DEFAULT_MODEL, type TranslateConfig, detectDir, parseJson, stripMacrons, translate } from './translate'
import '../test/romaji-node'

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

describe('detectDir', () => {
  it('Japanese script → listen, anything else → speak', () => {
    expect(detectDir('これはいくらですか？')).toBe('listen')
    expect(detectDir('ありがとう thanks')).toBe('listen')
    expect(detectDir('カタカナ')).toBe('listen')
    expect(detectDir('How much is this?')).toBe('speak')
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

  const cfg: TranslateConfig = { provider: 'openrouter', openrouterKey: 'sk-or-test' }
  afterEach(() => vi.unstubAllGlobals())

  it('speak: sends a JSON-mode request and returns macron-free romaji', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"ja":"ありがとう","romaji":"arigatō"}'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('speak', 'Thank you', [], 7, cfg)

    expect(t).toEqual({ id: 7, dir: 'speak', english: 'Thank you', japanese: 'ありがとう', romaji: 'arigatou' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-or-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODEL)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[1].content).toContain('Mode "speak"')
  })

  it('listen: maps {en, romaji} and honours the chosen model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"en":"How much is this?","romaji":"kore wa ikura desu ka"}'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('listen', 'これはいくらですか？', [], 0, { ...cfg, openrouterModel: 'qwen/qwen3.7-flash' })

    expect(t.english).toBe('How much is this?')
    expect(t.japanese).toBe('これはいくらですか？')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe('qwen/qwen3.7-flash')
  })

  it('throws a readable error on HTTP failure, error bodies and missing key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 402 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toThrow(/openrouter 402/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'upstream down' } }))))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toThrow(/upstream down/)

    await expect(translate('speak', 'hi', [], 0, { provider: 'openrouter' })).rejects.toThrow(/OpenRouter key is not set/)
  })
})

describe('translate via Google Cloud Translation (mocked fetch)', () => {
  const reply = (translatedText: string) =>
    new Response(JSON.stringify({ data: { translations: [{ translatedText }] } }), { status: 200 })

  const cfg: TranslateConfig = { provider: 'google', googleKey: 'g-key' }
  afterEach(() => vi.unstubAllGlobals())

  it('speak: en→ja via Google, romaji generated locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('これはいくらですか？'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('speak', 'How much is this?', [], 3, cfg)

    expect(t).toEqual({ id: 3, dir: 'speak', english: 'How much is this?', japanese: 'これはいくらですか？', romaji: 'kore wa ikura desu ka?' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('https://translation.googleapis.com/language/translate/v2?key=g-key')
    expect(JSON.parse(init.body)).toEqual({ q: 'How much is this?', source: 'en', target: 'ja', format: 'text' })
  })

  it('listen: ja→en via Google, romaji of the heard Japanese', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('Where is the station?')))
    const t = await translate('listen', '駅はどこですか', [], 4, cfg)
    expect(t).toEqual({ id: 4, dir: 'listen', japanese: '駅はどこですか', english: 'Where is the station?', romaji: 'eki wa doko desu ka' })
  })

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: 400 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toThrow(/google translate 400/)
  })
})

describe('translate via Anthropic (mocked fetch)', () => {
  const cfg: TranslateConfig = { provider: 'anthropic', anthropicKey: 'sk-ant-test' }
  afterEach(() => vi.unstubAllGlobals())

  it('calls the Messages API directly with the browser-access header and parses the JSON reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ja":"ありがとう","romaji":"arigatō"}' }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('speak', 'Thank you', [], 1, cfg)

    expect(t.romaji).toBe('arigatou')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant-test')
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(JSON.parse(init.body).model).toBe('claude-haiku-5-5')
  })

  it('surfaces API errors and a missing key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('overloaded', { status: 529 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toThrow(/anthropic 529/)
    await expect(translate('speak', 'hi', [], 0, { provider: 'anthropic' })).rejects.toThrow(/Anthropic key is not set/)
  })
})
