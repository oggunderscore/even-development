import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from '../protocol'
import { installNodeRomajiLoader } from '../test/romaji-node'
import { Engine } from './engine'
import { resolveConfig } from './config'
import { summarize, testConfig } from './probes'
import { RomajiNotInstalledError, setTokenizerLoader } from './romaji'

const googleCfg = () => resolveConfig({ keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-12345' }, provider: 'google' })
const googleOk = () => vi.fn().mockImplementation((url: string) =>
  Promise.resolve(
    String(url).endsWith('/languages') ? new Response('{}', { status: 200 }) : new Response(JSON.stringify({ data: { translations: [{ translatedText: 'How much is this?' }] } }), { status: 200 }),
  ),
)

beforeEach(() => setTokenizerLoader(() => Promise.reject(new RomajiNotInstalledError())))
afterEach(() => {
  vi.unstubAllGlobals()
  installNodeRomajiLoader()
})

describe('Google Translate before the romaji dictionary is downloaded', () => {
  it('a valid key is accepted and the check asks for the download, without a sample translation', async () => {
    const fetchMock = googleOk()
    vi.stubGlobal('fetch', fetchMock)
    const results = await testConfig(googleCfg(), 'translate')
    expect(results.map((r) => [r.service, r.ok])).toEqual([['google', true], ['romaji', false]])
    expect(results[1]!.action).toBe('download_dictionary')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the key check: no translate call yet
    const s = summarize(results)
    expect(s).toMatchObject({ ok: false, needsDictionary: true })
    expect(s.text).toMatch(/Key accepted\. The romaji dictionary \(about 18 MB\) needs to be downloaded/)
  })

  it('a REJECTED key never reaches the dictionary step: nothing is downloaded for a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 403 })))
    const results = await testConfig(googleCfg(), 'translate')
    expect(results).toHaveLength(1)
    expect(summarize(results)).toMatchObject({ ok: false })
    expect(summarize(results).needsDictionary).toBeUndefined()
    expect(results.some((r) => r.action)).toBe(false)
  })

  it('once the dictionary is installed the same check finishes with a test translation', async () => {
    installNodeRomajiLoader()
    vi.stubGlobal('fetch', googleOk())
    const results = await testConfig(googleCfg(), 'translate')
    expect(results.map((r) => [r.service, r.ok])).toEqual([['google', true], ['romaji', true], ['translate', true]])
    expect(summarize(results)).toEqual({ ok: true, text: 'Key accepted · test translation worked' })
  })

  it('other providers never ask for the dictionary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith('/key') ? new Response('{}', { status: 200 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"ja":"はい","romaji":"hai"}' } }] }), { status: 200 })),
    ))
    const results = await testConfig(resolveConfig({ keys: { openrouter: 'or-user-key-12345' }, provider: 'openrouter' }), 'translate')
    expect(results.some((r) => r.service === 'romaji' || r.action)).toBe(false)
    expect(summarize(results).ok).toBe(true)
  })

  it('the other person\'s Japanese is still translated to English (with no romaji), and the app is told once to fetch the dictionary', async () => {
    vi.stubGlobal('fetch', googleOk())
    const out: ServerMsg[] = []
    const engine = new Engine((m) => out.push(m))
    engine.handle({ type: 'config', config: { keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-12345' }, provider: 'google' } })
    engine.handle({ type: 'text', text: 'これはいくらですか' })
    engine.handle({ type: 'text', text: 'ありがとうございます' })
    await vi.waitFor(() => expect(out.filter((m) => m.type === 'final')).toHaveLength(2))
    const finals = out.filter((m) => m.type === 'final') as Extract<ServerMsg, { type: 'final' }>[]
    expect(finals.map((f) => [f.dir, f.english, f.romaji])).toEqual([['listen', 'How much is this?', ''], ['listen', 'How much is this?', '']])
    const notices = out.filter((m) => m.type === 'error' && m.code === 'no_romaji')
    expect(notices).toHaveLength(1) // not one per phrase
    expect(notices[0]).toMatchObject({ message: 'The romaji dictionary is not downloaded yet. Open Settings to download it.' })
    engine.close()
  })

  it('the wearer\'s own English has nothing to read aloud without romaji, so that one is a coded error and no wrong text', async () => {
    vi.stubGlobal('fetch', googleOk())
    const out: ServerMsg[] = []
    const engine = new Engine((m) => out.push(m))
    engine.handle({ type: 'config', config: { keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-12345' }, provider: 'google' } })
    engine.handle({ type: 'text', text: 'How much is this?' })
    await vi.waitFor(() => expect(out.some((m) => m.type === 'error' && m.code === 'no_romaji')).toBe(true))
    expect(out.some((m) => m.type === 'final')).toBe(false)
    engine.close()
  })
})
