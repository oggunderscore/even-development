import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from '../protocol'
import { Engine } from './engine'
import type { SttHandlers } from './stt'

const keys = { deepgram: 'dg-user-key-123', openrouter: 'or-user-key-123' }
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

function setup(opts: ConstructorParameters<typeof Engine>[1] = {}) {
  const out: ServerMsg[] = []
  const engine = new Engine((m) => out.push(m), { statsMs: 3_600_000, ...opts })
  return { engine, out }
}

describe('Engine', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks for keys (code no_keys) instead of starting a stream or translating', () => {
    const { engine, out } = setup()
    engine.handle({ type: 'config', config: {} })
    engine.handle({ type: 'start', mode: 'auto' })
    engine.handle({ type: 'text', text: 'Hello' })
    expect(out[0]).toMatchObject({ type: 'config_ok', stt: false, translate: false })
    expect(out.slice(1).map((m) => (m.type === 'error' ? m.code : m.type))).toEqual(['no_keys', 'no_keys'])
    engine.close()
  })

  it("never uses the host's keys unless a fallback is supplied", () => {
    const { engine, out } = setup()
    engine.handle({ type: 'config', config: {} })
    expect(out[0]).toMatchObject({ serverKeys: false })
    engine.close()
    const withFallback = setup({ fallback: { deepgramKey: 'server-dg-key-1', translate: { provider: 'openrouter', openrouterKey: 'server-or-key-1' } } })
    withFallback.engine.handle({ type: 'config', config: {} })
    expect(withFallback.out[0]).toMatchObject({ type: 'config_ok', stt: true, translate: true, serverKeys: true })
    withFallback.engine.close()
  })

  it('rejects malformed keys', () => {
    const { engine, out } = setup()
    engine.handle({ type: 'config', config: { keys: { deepgram: 'bad key\r\n' } } })
    expect(out[0]).toMatchObject({ type: 'error' })
    engine.close()
  })

  it('translates typed text with the user\'s own key and direction from the script', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('{"en":"How much is this?","romaji":"kore wa ikura desu ka"}')))
    const { engine, out } = setup()
    engine.handle({ type: 'config', config: { keys, provider: 'openrouter' } })
    engine.handle({ type: 'text', text: 'これはいくらですか' })
    await vi.waitFor(() => expect(out.some((m) => m.type === 'final')).toBe(true))
    expect(out.find((m) => m.type === 'final')).toMatchObject({ dir: 'listen', english: 'How much is this?', romaji: 'kore wa ikura desu ka' })
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(init.headers.Authorization).toBe('Bearer or-user-key-123')
    engine.close()
  })

  it('wires STT finals to translations, flushes on end and replies done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(reply('{"ja":"こんにちは","romaji":"konnichiwa"}'))))
    let handlers!: SttHandlers
    const finished = vi.fn().mockResolvedValue(undefined)
    const audio = vi.fn()
    const { engine, out } = setup({
      createStt: (_mode, h) => {
        handlers = h
        return { audio, finish: finished, abort: vi.fn() }
      },
    })
    engine.handle({ type: 'config', config: { keys, provider: 'openrouter' } })
    engine.handle({ type: 'start', mode: 'talk' })
    engine.audio(new Uint8Array(3200))
    expect(audio).toHaveBeenCalledOnce()

    handlers.onPartial('hel', 'speak')
    handlers.onFinal('Hello', 'speak')
    handlers.onFinal('uh', 'speak') // 2 chars: kept
    handlers.onFinal('.', 'speak') // too short: dropped
    engine.handle({ type: 'end' })
    await vi.waitFor(() => expect(out.some((m) => m.type === 'done')).toBe(true))

    expect(finished).toHaveBeenCalled()
    expect(out.filter((m) => m.type === 'final')).toHaveLength(2)
    expect(out.find((m) => m.type === 'partial')).toMatchObject({ text: 'hel', dir: 'speak' })
    expect(out.at(-1)).toMatchObject({ type: 'done' })
    engine.close()
  })

  it('reopens the always-on stream when it drops, then gives up after repeated failures', async () => {
    vi.useFakeTimers()
    try {
      const handlersList: SttHandlers[] = []
      const { engine, out } = setup({
        createStt: (_m, h) => {
          handlersList.push(h)
          return { audio: vi.fn(), finish: vi.fn(), abort: vi.fn() }
        },
      })
      engine.handle({ type: 'config', config: { keys, provider: 'openrouter' } })
      engine.handle({ type: 'start', mode: 'auto' })
      for (let i = 0; i < 5; i++) {
        handlersList.at(-1)!.onClose()
        await vi.advanceTimersByTimeAsync(600)
      }
      expect(handlersList.length).toBe(6) // 1 original + 5 reopenings
      handlersList.at(-1)!.onClose()
      expect(out.some((m) => m.type === 'error' && /keeps disconnecting/.test(m.message))).toBe(true)
      engine.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
