import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from './config'
import { summarize, testConfig } from './probes'
import './../test/romaji-node'

const orCfg = (model?: string) => resolveConfig({ keys: { deepgram: 'dg-user-key-123', openrouter: 'or-user-key-123' }, provider: 'openrouter', openrouterModel: model })
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

describe('testConfig: translate scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('key accepted and the chosen model answers a sample translation', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith('/key') ? new Response('{}', { status: 200 }) : reply('JA: いくらですか\nROMAJI: ikura desu ka')),
    )
    vi.stubGlobal('fetch', fetchMock)
    const results = await testConfig(orCfg('openai/gpt-4o-mini'), 'translate')
    expect(results.map((r) => [r.service, r.ok])).toEqual([['openrouter', true], ['translate', true]])
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('chat/completions'))!
    expect(JSON.parse(call[1].body).model).toBe('openai/gpt-4o-mini')
    expect(summarize(results)).toMatchObject({ ok: true, text: expect.stringMatching(/^Key accepted · test translation worked in \d+\.\ds$/) })
  })

  it('a rejected key says so in plain words and skips the sample translation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('no', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const results = await testConfig(orCfg(), 'translate')
    expect(results).toHaveLength(1)
    const s = summarize(results)
    expect(s.ok).toBe(false)
    expect(s.text).toMatch(/OpenRouter rejected this key \(HTTP 401\)/)
    expect(s.text).toMatch(/copied all of it/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a good key with a model that does not answer names the model and says what to do', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith('/key') ? new Response('{}', { status: 200 }) : new Response('model not found', { status: 404 })),
    ))
    const s = summarize(await testConfig(orCfg('old/retired-model'), 'translate'))
    expect(s.ok).toBe(false)
    expect(s.text).toBe('The key works, but a test translation with "old/retired-model" failed (K-MODEL). Try another model.')
    expect(s.text).not.toMatch(/not found/) // the provider's own words stay out of the UI
  })

  it('being offline reads as a connection problem, not a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const s = summarize(await testConfig(orCfg(), 'translate'))
    expect(s.text).toBe('Could not reach OpenRouter. Check your internet connection.')
  })

  it('no key entered is reported, never sent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const s = summarize(await testConfig(resolveConfig({ keys: { deepgram: 'dg-user-key-123' }, provider: 'openrouter' }), 'translate'))
    expect(s).toEqual({ ok: false, text: 'No key entered.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the Claude provider is tested with the chosen Claude model', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).includes('/models') ? new Response('{}', { status: 200 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ja":"はい","romaji":"hai"}' }] }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const cfg = resolveConfig({ keys: { anthropic: 'sk-ant-user-key-123' }, provider: 'anthropic', anthropicModel: 'claude-sonnet-5-5' })
    expect(summarize(await testConfig(cfg, 'translate')).ok).toBe(true)
    const msg = fetchMock.mock.calls.find((c) => String(c[0]).includes('/messages'))!
    expect(JSON.parse(msg[1].body).model).toBe('claude-sonnet-5-5')
  })
})

describe('testConfig: stt scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tests only Deepgram: no network call to the translation provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    class OpenSocket {
      onopen: (() => void) | null = null
      constructor() {
        setTimeout(() => this.onopen?.(), 0)
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', OpenSocket)
    const results = await testConfig(orCfg(), 'stt')
    expect(results).toEqual([{ service: 'deepgram', ok: true, detail: 'key accepted · live transcription reachable' }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a refused socket explains that the key was rejected or Deepgram could not be reached', async () => {
    class RefusedSocket {
      onerror: (() => void) | null = null
      constructor() {
        setTimeout(() => this.onerror?.(), 0)
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', RefusedSocket)
    const s = summarize(await testConfig(orCfg(), 'stt'))
    expect(s.ok).toBe(false)
    expect(s.text).toMatch(/Deepgram rejected this key, or could not be reached/)
  })

  it('results never contain a key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })))
    const all = JSON.stringify(await testConfig(orCfg(), 'translate'))
    expect(all).not.toContain('or-user-key-123')
  })
})
