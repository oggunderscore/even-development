import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DictRecord, DictStore } from './core/dictionary'
import { resilientStore, sha256Fallback, sha256Hex } from './dictionary-host'

describe('sha256 fallback (for a WebView with no Web Crypto)', () => {
  it('matches Node\'s SHA-256 across the padding edge cases and a large buffer', () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255)
      expect(sha256Fallback(data), `${n} bytes`).toBe(createHash('sha256').update(data).digest('hex'))
    }
  })

  it('the Web Crypto path and the fallback agree', async () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => i & 255)
    expect(await sha256Hex(data.buffer as ArrayBuffer)).toBe(sha256Fallback(data))
  })
})

const rec = (n: number): DictRecord => ({ sha256: `h${n}`, data: new ArrayBuffer(n) })

function store(opts: { failGet?: boolean; failPut?: boolean } = {}): DictStore & { m: Map<string, DictRecord> } {
  const m = new Map<string, DictRecord>()
  return {
    m,
    meta: async (n) => {
      if (opts.failGet) throw new Error('idb')
      const r = m.get(n)
      return r && { sha256: r.sha256, bytes: r.data.byteLength }
    },
    get: async (n) => {
      if (opts.failGet) throw new Error('idb')
      return m.get(n)
    },
    put: async (n, r) => {
      if (opts.failPut) throw new Error('quota')
      m.set(n, r)
    },
  }
}

describe('resilientStore', () => {
  it('uses the primary store normally', async () => {
    const p = store()
    const f = store()
    const s = resilientStore(p, f)
    await s.put('a', rec(1))
    expect(p.m.has('a')).toBe(true)
    expect(f.m.has('a')).toBe(false)
    expect(await s.get('a')).toEqual(rec(1))
  })

  it('if the primary refuses a write (blocked, full), the file is kept for this session instead', async () => {
    const s = resilientStore(store({ failPut: true }), store())
    await s.put('a', rec(2))
    expect(await s.get('a')).toEqual(rec(2))
  })

  it('says when it had to keep a file in memory only (so the app can warn it will be downloaded again), and not otherwise', async () => {
    const good = resilientStore(store(), store())
    await good.put('a', rec(1))
    expect(good.volatile?.()).toBe(false)
    const bad = resilientStore(store({ failPut: true }), store())
    expect(bad.volatile?.()).toBe(false)
    await bad.put('a', rec(2))
    expect(bad.volatile?.()).toBe(true)
    expect(await bad.meta('a')).toEqual({ sha256: 'h2', bytes: 2 })
  })

  it('if the primary can\'t be read, the session copy is still found', async () => {
    const fallback = store()
    await fallback.put('a', rec(3))
    expect(await resilientStore(store({ failGet: true }), fallback).get('a')).toEqual(rec(3))
  })
})
