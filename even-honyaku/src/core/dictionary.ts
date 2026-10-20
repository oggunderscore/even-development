// The romaji dictionary (kuromoji, ~18 MB) is not shipped in the app: it is downloaded once, only when a Google Translate
// key has been accepted (the LLM providers write romaji themselves and never need it), verified, and kept in the phone's
// own storage. Keeping it out of the package is what keeps the .ehpk far under Even Hub's ~10 MB practical size cap.
//
// This file is the logic only (what is missing, download, verify, store), with the network, the storage and the hash
// injected, so it is testable in Node. The browser wiring is in src/dictionary-host.ts.

export interface DictFile {
  name: string
  bytes: number
  /** Lower-case hex SHA-256 of the file. A download that doesn't match is thrown away. */
  sha256: string
}

export interface DictRecord {
  sha256: string
  data: ArrayBuffer
}

/** What is known about a stored file without reading its (large) contents. */
export interface DictMeta {
  sha256: string
  bytes: number
}

/** Where downloaded files are kept between launches. */
export interface DictStore {
  /** Cheap: size and hash only, so "is it installed?" never reads 18 MB. */
  meta(name: string): Promise<DictMeta | undefined>
  get(name: string): Promise<DictRecord | undefined>
  put(name: string, record: DictRecord): Promise<void>
  /** True if a write had to fall back to memory that will not survive a restart (see dictionary-host.ts). */
  readonly volatile?: () => boolean
}

export interface DictDeps {
  /** Ends with "/": the CDN folder holding the files at the pinned package version. */
  baseUrl: string
  files: DictFile[]
  fetch: typeof fetch
  store: DictStore
  sha256(data: ArrayBuffer): Promise<string>
  /** A download that receives nothing for this long is abandoned (default 30 s), so a stalled connection can't hang forever. */
  stallMs?: number
}

export interface DictProgress {
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
}

/** `network`: couldn't fetch it. `corrupt`: it arrived but isn't the file we expected. `storage`: the phone wouldn't keep it. */
export class DictionaryError extends Error {
  constructor(
    readonly kind: 'network' | 'corrupt' | 'storage',
    message: string,
  ) {
    super(message)
  }
}

export const totalBytes = (files: DictFile[]) => files.reduce((n, f) => n + f.bytes, 0)

const isGood = (rec: DictMeta | undefined, file: DictFile): boolean => !!rec && rec.sha256 === file.sha256 && rec.bytes === file.bytes

/** The files not (correctly) stored yet. A stored file with the wrong hash or size counts as missing. */
export async function missingFiles(deps: DictDeps): Promise<DictFile[]> {
  const missing: DictFile[] = []
  for (const f of deps.files) {
    let rec: DictMeta | undefined
    try {
      rec = await deps.store.meta(f.name)
    } catch {
      rec = undefined
    }
    if (!isGood(rec, f)) missing.push(f)
  }
  return missing
}

export async function isInstalled(deps: DictDeps): Promise<boolean> {
  return (await missingFiles(deps)).length === 0
}

/** Download the files that are missing, verifying each, and keep them. Files already stored are not fetched again. */
export async function downloadMissing(deps: DictDeps, onProgress: (p: DictProgress) => void = () => {}): Promise<void> {
  const missing = await missingFiles(deps)
  const total = totalBytes(deps.files)
  const have = new Set(deps.files.filter((f) => !missing.includes(f)).map((f) => f.name))
  let doneBytes = totalBytes(deps.files.filter((f) => have.has(f.name)))
  let doneFiles = have.size
  const report = () => onProgress({ doneBytes, totalBytes: total, doneFiles, totalFiles: deps.files.length })
  report()

  const fetchOne = async (file: DictFile) => {
    // Give up on a connection that has gone quiet instead of waiting forever: every byte received restarts the clock.
    const ctl = new AbortController()
    const stall = deps.stallMs ?? 30_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), stall)
    }
    arm()
    try {
      await fetchOneInner(file, ctl.signal, arm)
    } catch (err) {
      if (ctl.signal.aborted) throw new DictionaryError('network', 'The download stalled (no data for 30 seconds). Check your internet connection and retry.')
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  const fetchOneInner = async (file: DictFile, signal: AbortSignal, arm: () => void) => {
    let res: Response
    try {
      res = await deps.fetch(deps.baseUrl + file.name, { signal })
    } catch {
      throw new DictionaryError('network', 'Could not reach the download server. Check your internet connection.')
    }
    if (!res.ok) throw new DictionaryError('network', `The download server answered with an error (HTTP ${res.status}).`)
    arm()

    // Read as it arrives so the progress bar moves, falling back to one read where streaming isn't available.
    const chunks: Uint8Array[] = []
    let got = 0
    try {
      if (res.body) {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          arm()
          chunks.push(value)
          got += value.byteLength
          doneBytes += value.byteLength
          report()
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer())
        chunks.push(buf)
        got = buf.byteLength
        doneBytes += got
        report()
      }
    } catch {
      doneBytes -= got
      throw new DictionaryError('network', 'The download was interrupted. Check your internet connection.')
    }

    const data = new Uint8Array(got)
    let at = 0
    for (const c of chunks) {
      data.set(c, at)
      at += c.byteLength
    }
    const buffer = data.buffer as ArrayBuffer
    if (got !== file.bytes || (await deps.sha256(buffer)) !== file.sha256) {
      doneBytes -= got
      throw new DictionaryError('corrupt', `The downloaded file ${file.name} is not the expected one, so it was discarded.`)
    }
    try {
      await deps.store.put(file.name, { sha256: file.sha256, data: buffer })
    } catch {
      throw new DictionaryError('storage', 'The phone would not store the dictionary (is its storage full?).')
    }
    doneFiles++
    report()
  }

  // A few at a time: the big files dominate, and several connections finish sooner than one.
  const queue = [...missing].sort((a, b) => b.bytes - a.bytes)
  let failure: unknown
  const worker = async () => {
    for (let file = queue.shift(); file && !failure; file = queue.shift()) {
      try {
        await fetchOne(file)
      } catch (err) {
        failure ??= err
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (failure) throw failure
}

/** All the stored files, by name. Throws if any is missing (the caller says "download it first"). */
export async function readAll(deps: DictDeps): Promise<Map<string, ArrayBuffer>> {
  const out = new Map<string, ArrayBuffer>()
  for (const f of deps.files) {
    const rec = await deps.store.get(f.name)
    if (!rec || !isGood({ sha256: rec.sha256, bytes: rec.data.byteLength }, f)) {
      throw new DictionaryError('storage', `The romaji dictionary is not fully downloaded (${f.name} is missing).`)
    }
    out.set(f.name, rec.data)
  }
  return out
}
