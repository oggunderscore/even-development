import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { type DictDeps, type DictFile, type DictProgress, type DictRecord, DictionaryError, downloadMissing, isInstalled, missingFiles, readAll, totalBytes } from './dictionary'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * seed + 1) & 255)

const contents: Record<string, Uint8Array> = { 'a.dat.gz': bytes(3000, 3), 'b.dat.gz': bytes(500, 5), 'c.dat.gz': bytes(40, 7) }
const files: DictFile[] = Object.entries(contents).map(([name, b]) => ({ name, bytes: b.length, sha256: sha(b) }))

/** A fetch that serves `contents` in small chunks (so progress can be observed), with optional misbehaviour. */
function fakeFetch(over: Partial<Record<string, () => Response | Promise<Response>>> = {}) {
  const calls: string[] = []
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const name = url.split('/').at(-1)!
    calls.push(name)
    if (over[name]) return over[name]!()
    const body = contents[name]
    if (!body) return new Response('no', { status: 404 })
    let at = 0
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (at >= body.length) return controller.close()
          controller.enqueue(body.slice(at, at + 700))
          at += 700
        },
      }),
      { status: 200 },
    )
  })
  return { fetch: f as unknown as typeof fetch, calls }
}

function setup(over: Parameters<typeof fakeFetch>[0] = {}, store: Map<string, DictRecord> = new Map(), putFails = false) {
  const net = fakeFetch(over)
  const deps: DictDeps = {
    baseUrl: 'https://cdn.example/dict/',
    files,
    fetch: net.fetch,
    store: {
      meta: async (n) => {
        const r = store.get(n)
        return r && { sha256: r.sha256, bytes: r.data.byteLength }
      },
      get: async (n) => store.get(n),
      put: async (n, r) => {
        if (putFails) throw new Error('quota')
        store.set(n, r)
      },
    },
    sha256: async (d) => sha(new Uint8Array(d)),
  }
  return { deps, store, net }
}

describe('downloadMissing', () => {
  it('downloads every file, verifies it, stores it, and reports progress up to 100%', async () => {
    const { deps, store, net } = setup()
    const seen: DictProgress[] = []
    await downloadMissing(deps, (p) => seen.push(p))
    expect(new Set(net.calls)).toEqual(new Set(Object.keys(contents)))
    expect([...store.keys()].sort()).toEqual(Object.keys(contents).sort())
    expect(await isInstalled(deps)).toBe(true)
    const last = seen.at(-1)!
    expect(last).toMatchObject({ doneBytes: totalBytes(files), totalBytes: totalBytes(files), doneFiles: 3, totalFiles: 3 })
    expect(seen.map((p) => p.doneBytes)).toEqual([...seen.map((p) => p.doneBytes)].sort((a, b) => a - b)) // never goes backwards
    expect(seen.length).toBeGreaterThan(3) // moved while downloading, not just at the end
  })

  it('files already stored are not downloaded again, and count as done from the start', async () => {
    const store = new Map<string, DictRecord>()
    store.set('a.dat.gz', { sha256: files[0]!.sha256, data: contents['a.dat.gz']!.buffer.slice(0) as ArrayBuffer })
    const { deps, net } = setup({}, store)
    const seen: DictProgress[] = []
    await downloadMissing(deps, (p) => seen.push(p))
    expect(net.calls).not.toContain('a.dat.gz')
    expect(seen[0]).toMatchObject({ doneFiles: 1, doneBytes: 3000 })
  })

  it('a stored file with the wrong hash or size is treated as missing and replaced', async () => {
    const store = new Map<string, DictRecord>()
    store.set('b.dat.gz', { sha256: 'bad', data: new ArrayBuffer(500) })
    const { deps } = setup({}, store)
    expect((await missingFiles(deps)).map((f) => f.name)).toContain('b.dat.gz')
    await downloadMissing(deps)
    expect(store.get('b.dat.gz')!.sha256).toBe(files[1]!.sha256)
  })

  it('a file that arrives altered is rejected as corrupt and never stored', async () => {
    const tampered = bytes(500, 9) // right size, wrong content
    const { deps, store } = setup({ 'b.dat.gz': () => new Response(tampered) })
    await expect(downloadMissing(deps)).rejects.toMatchObject({ kind: 'corrupt' })
    expect(store.has('b.dat.gz')).toBe(false)
    expect(await isInstalled(deps)).toBe(false)
  })

  it('a truncated file is rejected as corrupt', async () => {
    const { deps, store } = setup({ 'a.dat.gz': () => new Response(contents['a.dat.gz']!.slice(0, 1000)) })
    await expect(downloadMissing(deps)).rejects.toBeInstanceOf(DictionaryError)
    expect(store.has('a.dat.gz')).toBe(false)
  })

  it('an unreachable server and an HTTP error are network failures with a plain message', async () => {
    const offline = setup({ 'a.dat.gz': () => Promise.reject(new TypeError('Failed to fetch')) })
    await expect(downloadMissing(offline.deps)).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('internet connection') })
    const missing = setup({ 'c.dat.gz': () => new Response('no', { status: 503 }) })
    await expect(downloadMissing(missing.deps)).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('HTTP 503') })
  })

  it('storage that refuses the file is its own, clear failure', async () => {
    const { deps } = setup({}, new Map(), true)
    await expect(downloadMissing(deps)).rejects.toMatchObject({ kind: 'storage', message: expect.stringContaining('storage') })
  })

  it('after a failed attempt, a retry fetches only what is still missing', async () => {
    const store = new Map<string, DictRecord>()
    const flaky = setup({ 'a.dat.gz': () => Promise.reject(new TypeError('x')) }, store)
    await expect(downloadMissing(flaky.deps)).rejects.toBeInstanceOf(DictionaryError)
    const retry = setup({}, store)
    await downloadMissing(retry.deps)
    expect(retry.net.calls).toEqual(['a.dat.gz'])
    expect(await isInstalled(retry.deps)).toBe(true)
  })

  it('fetches from the pinned folder it was given and nowhere else', async () => {
    const { deps, net } = setup()
    await downloadMissing(deps)
    const urls = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u.startsWith('https://cdn.example/dict/'))).toBe(true)
    expect(net.calls).toHaveLength(3)
  })
})

describe('"is it installed?" never reads the big files', () => {
  it('missingFiles / isInstalled use only the small metadata records', async () => {
    const { deps } = setup()
    await downloadMissing(deps)
    const get = vi.spyOn(deps.store, 'get')
    expect(await isInstalled(deps)).toBe(true)
    expect(await missingFiles(deps)).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })
})

describe('a stalled download', () => {
  it('is abandoned after the stall time instead of hanging forever, with a message that says what to do', async () => {
    vi.useFakeTimers()
    try {
      // a connection that answers and then goes silent: the stream never delivers anything (and honours abort)
      const silent = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
            },
          }),
        ),
      )
      const { deps } = setup()
      const run = downloadMissing({ ...deps, fetch: silent as unknown as typeof fetch, stallMs: 5000 })
      const assertion = expect(run).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('stalled') })
      await vi.advanceTimersByTimeAsync(6000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('every byte that arrives restarts the clock, so a slow but steady download is not cut off', async () => {
    vi.useFakeTimers()
    try {
      const slow = vi.fn(async (u: RequestInfo | URL) => {
        const name = String(u).split('/').at(-1)!
        const body = contents[name]!
        let at = 0
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await new Promise((r) => setTimeout(r, 3000)) // 3 s between chunks, under the 5 s stall limit
              if (at >= body.length) return controller.close()
              controller.enqueue(body.slice(at, at + 700))
              at += 700
            },
          }),
        )
      })
      const { deps } = setup()
      const run = downloadMissing({ ...deps, fetch: slow as unknown as typeof fetch, stallMs: 5000 })
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(run).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('readAll', () => {
  it('returns every stored file, and refuses with a clear error if any is missing', async () => {
    const { deps } = setup()
    await expect(readAll(deps)).rejects.toBeInstanceOf(DictionaryError)
    await downloadMissing(deps)
    const all = await readAll(deps)
    expect([...all.keys()].sort()).toEqual(Object.keys(contents).sort())
    expect(new Uint8Array(all.get('c.dat.gz')!)).toEqual(contents['c.dat.gz'])
  })
})
