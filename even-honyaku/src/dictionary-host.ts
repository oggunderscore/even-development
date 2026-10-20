// Browser wiring for the romaji dictionary download (see core/dictionary.ts for the logic): IndexedDB for storage, Web
// Crypto (or a small fallback) for the hash, and a CDN folder pinned to the exact kuromoji version the app was built with.

import { type DictDeps, type DictMeta, type DictRecord, type DictStore } from './core/dictionary'
import { DICT_FILES, DICT_PACKAGE, DICT_VERSION } from './dictionary-manifest'

/** jsDelivr serves npm package files over HTTPS with CORS, immutably cached, as raw bytes (no content-encoding). */
export const DICT_BASE_URL = `https://cdn.jsdelivr.net/npm/${DICT_PACKAGE}@${DICT_VERSION}/dict/`

const DB_NAME = 'honyaku-romaji-dictionary'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Files kept in IndexedDB so they survive restarts (it "persists, best effort": a missing file is simply fetched again). */
function idbStore(): DictStore {
  let db: Promise<IDBDatabase> | undefined
  const open = () => (db ??= openDb())
  const run = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    open().then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const req = f(d.transaction(STORE, mode).objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }),
    )
  // The big file and a tiny "meta:" record (size + hash) are kept apart, so asking "is it installed?" reads bytes, not megabytes.
  return {
    meta: (name) => run('readonly', (s) => s.get(`meta:${name}`) as IDBRequest<DictMeta | undefined>),
    get: (name) => run('readonly', (s) => s.get(name) as IDBRequest<DictRecord | undefined>),
    put: async (name, record) => {
      await run('readwrite', (s) => s.put(record, name))
      // written last: a meta record only ever describes a file that is fully stored
      await run('readwrite', (s) => s.put({ sha256: record.sha256, bytes: record.data.byteLength } satisfies DictMeta, `meta:${name}`))
    },
  }
}

/** A store that lasts only this session, for a WebView where IndexedDB isn't available (the files are fetched again next launch). */
function memoryStore(): DictStore {
  const m = new Map<string, DictRecord>()
  return {
    meta: async (n) => {
      const r = m.get(n)
      return r && { sha256: r.sha256, bytes: r.data.byteLength }
    },
    get: async (n) => m.get(n),
    put: async (n, r) => void m.set(n, r),
  }
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) return hex(await crypto.subtle.digest('SHA-256', data))
  return sha256Fallback(new Uint8Array(data))
}

// Plain SHA-256 for a WebView without Web Crypto (it needs a secure context). ~100 MB/s is plenty for 18 MB, once.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256Fallback(data: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const len = data.length
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000))
  view.setUint32(padded.length - 4, (len * 8) >>> 0)
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) | 0
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) | 0
      hh = g
      g = f
      f = e
      e = (d! + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] = (h[0]! + a!) | 0
    h[1] = (h[1]! + b!) | 0
    h[2] = (h[2]! + c!) | 0
    h[3] = (h[3]! + d!) | 0
    h[4] = (h[4]! + e!) | 0
    h[5] = (h[5]! + f!) | 0
    h[6] = (h[6]! + g!) | 0
    h[7] = (h[7]! + hh!) | 0
  }
  return [...h].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

/** IndexedDB first; if it fails at runtime (blocked, full, no permission) keep the files for this session instead of giving up. */
export function resilientStore(primary: DictStore, fallback: DictStore): DictStore {
  let fellBack = false
  return {
    volatile: () => fellBack,
    meta: async (name) => {
      try {
        const m = await primary.meta(name)
        if (m) return m
      } catch {
        /* fall through to the session copy */
      }
      return fallback.meta(name)
    },
    get: async (name) => {
      try {
        const rec = await primary.get(name)
        if (rec) return rec
      } catch {
        /* fall through to the session copy */
      }
      return fallback.get(name)
    },
    put: async (name, record) => {
      try {
        await primary.put(name, record)
      } catch {
        fellBack = true // kept for this session only: the app must not claim it is saved
        await fallback.put(name, record)
      }
    },
  }
}

let deps: DictDeps | undefined

/** The real dependencies: this page's fetch, IndexedDB (or memory if unavailable), Web Crypto. */
export function dictDeps(): DictDeps {
  deps ??= {
    baseUrl: DICT_BASE_URL,
    files: DICT_FILES,
    fetch: (input, init) => fetch(input, init),
    store: typeof indexedDB === 'undefined' ? memoryStore() : resilientStore(idbStore(), memoryStore()),
    sha256: sha256Hex,
  }
  return deps
}
