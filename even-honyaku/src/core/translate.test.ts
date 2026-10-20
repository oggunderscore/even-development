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

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'upstream down', code: 502 } })))))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'SVC', message: 'openrouter body error 502' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'AUTH' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    await expect(translate('speak', 'hi', [], 0, cfg)).rejects.toMatchObject({ kind: 'MODEL' })

    await expect(translate('speak', 'hi', [], 0, { provider: 'openrouter' })).rejects.toMatchObject({ kind: 'AUTH' })
  })

  it('a call that gets no answer for 3 seconds is retried once, then fails as TIME', async () => {
    vi.useFakeTimers()
    try {
      const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))))
      vi.stubGlobal('fetch', f)
      const run = translate('speak', 'hi', [], 0, cfg).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(2900)
      expect(f).toHaveBeenCalledTimes(1) // still within the first 3 seconds
      await vi.advanceTimersByTimeAsync(200)
      expect(f).toHaveBeenCalledTimes(2) // retried
      await vi.advanceTimersByTimeAsync(2900)
      expect(await run).toMatchObject({ kind: 'TIME' })
      expect(f).toHaveBeenCalledTimes(2) // and only once
    } finally {
      vi.useRealTimers()
    }
  })

  it('the retry can succeed: the first attempt is quiet, the second answers', async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_u: string, init: RequestInit) =>
          ++n === 1 ? new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))) : Promise.resolve(reply('JA: はい\nROMAJI: hai')),
        ),
      )
      const run = translate('speak', 'yes', [], 0, cfg)
      await vi.advanceTimersByTimeAsync(3100)
      expect(await run).toMatchObject({ japanese: 'はい', romaji: 'hai' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('network and server failures are retried once; a rejected key, a rate limit or a bad model are not', async () => {
    const calls = async (first: () => Promise<Response>) => {
      const f = vi.fn().mockImplementationOnce(first).mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'JA: はい\nROMAJI: hai' } }] }))))
      vi.stubGlobal('fetch', f)
      await translate('speak', 'yes', [], 0, cfg).catch(() => undefined)
      return f.mock.calls.length
    }
    expect(await calls(() => Promise.reject(new TypeError('Failed to fetch')))).toBe(2)
    expect(await calls(() => Promise.resolve(new Response('{}', { status: 503 })))).toBe(2)
    expect(await calls(() => Promise.resolve(new Response('{}', { status: 401 })))).toBe(1)
    expect(await calls(() => Promise.resolve(new Response('{}', { status: 429 })))).toBe(1)
    expect(await calls(() => Promise.resolve(new Response('{}', { status: 404 })))).toBe(1)
  })

  it('a stream is only given up on when it goes quiet: a slow but steady one completes, a stalled one is retried', async () => {
    vi.useFakeTimers()
    try {
      const enc = new TextEncoder()
      const sse = (parts: string[], stallAfter?: number, signal?: AbortSignal | null) => {
        let i = 0
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (c) => signal?.addEventListener('abort', () => c.error(new DOMException('x', 'AbortError'))),
            pull: async (c) => {
              if (stallAfter !== undefined && i >= stallAfter) return new Promise<void>(() => {})
              if (i >= parts.length) return c.close()
              await new Promise((r) => setTimeout(r, 2500)) // each piece takes 2.5 s: the whole answer 10 s
              c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`))
            },
          }),
        )
      }
      const parts = ['single\n', 'Thanks ', '| arigatou', '\n']
      vi.stubGlobal('fetch', vi.fn().mockImplementation((_u: string, init: RequestInit) => Promise.resolve(sse(parts, undefined, init.signal))))
      const steady = complete('s', 'u', cfg, { onText: () => {} })
      await vi.advanceTimersByTimeAsync(11_000)
      expect(await steady).toBe('single\nThanks | arigatou\n') // took 10 s, never silent for 3

      let n = 0
      const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => Promise.resolve(++n === 1 ? sse(parts, 1, init.signal) : sse(parts, undefined, init.signal)))
      vi.stubGlobal('fetch', f)
      const stalled = complete('s', 'u', cfg, { onText: () => {} })
      await vi.advanceTimersByTimeAsync(20_000)
      expect(await stalled).toBe('single\nThanks | arigatou\n')
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the key check allows a slower first request and does not retry', async () => {
    vi.useFakeTimers()
    try {
      const f = vi.fn().mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))))
      vi.stubGlobal('fetch', f)
      const run = translate('speak', 'hi', [], 0, cfg, { timeoutMs: 10_000, retries: 0 }).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(9000)
      expect(f).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1500)
      expect(await run).toMatchObject({ kind: 'TIME' })
      expect(f).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
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

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(sse([{ type: 'content_block_delta', delta: { text: 'x' } }, { type: 'message_delta', delta: { stop_reason: 'refusal' } }]))))
    await expect(complete('s', 'u', cfg, { onText: () => {} })).rejects.toMatchObject({ kind: 'DECL' })

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(sse([{ type: 'error', error: { type: 'overloaded_error', message: 'secret text' } }]))))
    await expect(complete('s', 'u', cfg, { onText: () => {} })).rejects.toMatchObject({ kind: 'SVC', message: 'anthropic stream overloaded_error' })
  })
})
