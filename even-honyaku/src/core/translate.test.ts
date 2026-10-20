import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_DEFAULT_MODEL, type TranslateConfig, complete, detectDir, parseJson, parseLabeled, stripMacrons, translate } from './translate'
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

describe('parseLabeled', () => {
  it('reads the labelled lines', () => {
    expect(parseLabeled('JA: こんにちは\nROMAJI: konnichiwa')).toEqual({ ja: 'こんにちは', romaji: 'konnichiwa' })
  })
  it('tolerates quotes, bold labels, bullets, fences, lower case and chatter', () => {
    expect(parseLabeled('Sure!\n```\n- **EN:** "Hello there"\nromaji: yaa\n```')).toEqual({ en: 'Hello there', romaji: 'yaa' })
    expect(parseLabeled('JA：「ありがとう」\nROMAJI: arigatou')).toEqual({ ja: 'ありがとう', romaji: 'arigatou' })
  })
  it('falls back to a JSON object from a model that ignored the format', () => {
    expect(parseLabeled('{"ja":"こんにちは","romaji":"konnichiwa"}')).toEqual({ ja: 'こんにちは', romaji: 'konnichiwa' })
  })
  it('broken output is a coded failure that carries none of the text', () => {
    const err = (() => {
      try {
        parseLabeled('{"ja": "x" "romaji": }')
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toMatchObject({ kind: 'FORM' })
    expect(err!.message).not.toContain('romaji')
  })
})

describe('parseJson', () => {
  it('parses an object out of chatter and fences', () => {
    expect(parseJson('Sure!\n```json\n{"en":"hi"}\n```')).toEqual({ en: 'hi' })
  })
  it('throws a coded failure, never the text', () => {
    expect(() => parseJson('no json here')).toThrow(expect.objectContaining({ kind: 'FORM', message: 'no json' }))
    expect(() => parseJson('{"a" "b"}')).toThrow(expect.objectContaining({ kind: 'FORM', message: 'bad json' }))
  })
})

describe('translate via OpenRouter (mocked fetch)', () => {
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

  const cfg: TranslateConfig = { provider: 'openrouter', openrouterKey: 'sk-or-test' }
  afterEach(() => vi.unstubAllGlobals())

  it('speak: asks for plain labelled lines and returns macron-free romaji', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('JA: ありがとう\nROMAJI: arigatō'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('speak', 'Thank you', [], 7, cfg)

    expect(t).toEqual({ id: 7, dir: 'speak', english: 'Thank you', japanese: 'ありがとう', romaji: 'arigatou' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-or-test')
    const body = JSON.parse(init.body)
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODEL)
    expect(body.response_format).toBeUndefined()
    expect(body.stream).toBe(false)
    expect(body.messages[0].content).toContain('JA:')
    expect(body.messages[1].content).toContain('Thank you')
  })

  it('listen: maps EN and ROMAJI and honours the chosen model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('EN: How much is this?\nROMAJI: kore wa ikura desu ka'))
    vi.stubGlobal('fetch', fetchMock)

    const t = await translate('listen', 'これはいくらですか？', [], 0, { ...cfg, openrouterModel: 'qwen/qwen3.7-flash' })

    expect(t.english).toBe('How much is this?')
    expect(t.japanese).toBe('これはいくらですか？')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe('qwen/qwen3.7-flash')
  })

  it('listen without romaji (Predictive mode) does not ask for it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('EN: Hot or iced?'))
    vi.stubGlobal('fetch', fetchMock)
    const t = await translate('listen', 'ホットですか、アイスですか', [], 0, cfg, { romaji: false })
    expect(t).toMatchObject({ english: 'Hot or iced?', romaji: '' })
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body.messages[0].content).not.toContain('ROMAJI')
    expect(body.max_tokens).toBeLessThan(200)
  })

  it('an answer without the expected line is a coded FORM failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('Sorry, I cannot translate that.')))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'FORM' })
  })

  it('failures are coded by cause; the upstream text never travels with them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"Your key sk-or-secret ran out","code":"insufficient_quota"}}', { status: 402 })))
    const err = await translate('speak', 'hi', [], 0, cfg).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'RATE', message: 'openrouter 402 insufficient_quota' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'upstream down', code: 502 } }))))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'SVC', message: 'openrouter body error 502' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'AUTH' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'MODEL' })

    await expect(translate('speak', 'hi', [], 0, { provider: 'openrouter' })).rejects.toMatchObject({ kind: 'AUTH' })
  })

  it('a reply that takes too long is a TIME failure', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))))
      const run = translate('speak', 'hi', [], 0, cfg).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(21_000)
      expect(await run).toMatchObject({ kind: 'TIME' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('request tuning per model (mocked fetch)', () => {
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], content: [{ type: 'text', text: content }] }), { status: 200 })
  afterEach(() => vi.unstubAllGlobals())
  const body = (mock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(mock.mock.calls[call]![1].body)
  const or = (model: string): TranslateConfig => ({ provider: 'openrouter', openrouterKey: 'k', openrouterModel: model })

  it('Claude Haiku via OpenRouter: reasoning off, lowest-latency routing, and no temperature (it rejects one)', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, or('anthropic/claude-haiku-5.5'))
    expect(body(f)).toMatchObject({ reasoning: { effort: 'none' }, provider: { sort: 'latency' } })
    expect(body(f)).not.toHaveProperty('temperature')
  })

  it('Qwen3.7 Flash is switched to no reasoning with the enabled flag instead', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, or('qwen/qwen3.7-flash'))
    expect(body(f)).toMatchObject({ reasoning: { enabled: false }, temperature: 0 })
  })

  it('a model that is not on the list (set earlier) gets temperature 0 and no reasoning option', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, or('qwen/qwen3-235b-a22b-2507'))
    expect(body(f)).toMatchObject({ temperature: 0 })
    expect(body(f)).not.toHaveProperty('reasoning')
  })

  it('if the provider refuses the options the plain request is sent, with room for any thinking', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, or('anthropic/claude-haiku-5.5'))
    const first = body(f, 0)
    const plain = body(f, 1)
    for (const k of ['reasoning', 'provider', 'temperature']) expect(plain).not.toHaveProperty(k)
    expect(plain.max_tokens).toBe(first.max_tokens * 4)
  })

  it('direct Claude: Haiku 5.5 has thinking disabled and low effort, Sonnet 5.5 uses between_tools, neither gets temperature', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, { provider: 'anthropic', anthropicKey: 'k' })
    await translate('speak', 'yes', [], 0, { provider: 'anthropic', anthropicKey: 'k', anthropicModel: 'claude-sonnet-5-5' })
    expect(body(f, 0)).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, output_config: { effort: 'low' } })
    expect(body(f, 1)).toMatchObject({ thinking: { type: 'between_tools' }, output_config: { effort: 'low' } })
    for (const i of [0, 1]) expect(body(f, i)).not.toHaveProperty('temperature')
  })

  it('direct Claude falls back to a plain request if the thinking options are refused', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 400 })).mockImplementation(() => Promise.resolve(ok('JA: はい\nROMAJI: hai')))
    vi.stubGlobal('fetch', f)
    await translate('speak', 'yes', [], 0, { provider: 'anthropic', anthropicKey: 'k' })
    expect(body(f, 1)).not.toHaveProperty('thinking')
    expect(body(f, 1).max_tokens).toBe(body(f, 0).max_tokens * 4)
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
    // the key travels in a header, never in the URL
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2')
    expect(init.headers['X-Goog-Api-Key']).toBe('g-key')
    expect(JSON.parse(init.body)).toEqual({ q: 'How much is this?', source: 'en', target: 'ja', format: 'text' })
  })

  it('listen: ja→en via Google, romaji of the heard Japanese', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('Where is the station?')))
    const t = await translate('listen', '駅はどこですか', [], 4, cfg)
    expect(t).toEqual({ id: 4, dir: 'listen', japanese: '駅はどこですか', english: 'Where is the station?', romaji: 'eki wa doko desu ka' })
  })

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: 400 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'UNK', message: 'google 400' })
  })
})

describe('translate via Anthropic (mocked fetch)', () => {
  const cfg: TranslateConfig = { provider: 'anthropic', anthropicKey: 'sk-ant-test' }
  afterEach(() => vi.unstubAllGlobals())

  it('calls the Messages API directly with the browser-access header and parses the labelled reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'JA: ありがとう\nROMAJI: arigatō' }] }), { status: 200 }),
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
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'SVC', message: 'anthropic 529' })
    await expect(translate('speak', 'hi', [], 0, { provider: 'anthropic' })).rejects.toMatchObject({ kind: 'AUTH' })
  })

  it('streams text deltas and reports a refusal as DECL', async () => {
    const sse = (events: object[]) => new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sse([
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'single\nYes ' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '| hai\n' } },
          { type: 'message_stop' },
        ]),
      ),
    )
    const seen: string[] = []
    expect(await complete('s', 'u', cfg, { onText: (t) => seen.push(t) })).toBe('single\nYes | hai\n')
    expect(seen).toEqual(['single\nYes ', 'single\nYes | hai\n'])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([{ type: 'content_block_delta', delta: { text: 'x' } }, { type: 'message_delta', delta: { stop_reason: 'refusal' } }])))
    await expect(complete('s', 'u', cfg, { onText: () => {} })).rejects.toMatchObject({ kind: 'DECL' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([{ type: 'error', error: { type: 'overloaded_error', message: 'secret text' } }])))
    await expect(complete('s', 'u', cfg, { onText: () => {} })).rejects.toMatchObject({ kind: 'SVC', message: 'anthropic stream overloaded_error' })
  })
})
