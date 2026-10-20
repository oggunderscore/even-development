// Browser host for the romaji dictionary. The files are not part of the app: they are downloaded once (see
// dictionary-host.ts), after a Google Translate key has been accepted, and kept in IndexedDB. Translating only ever reads
// that copy; it never starts a download in the middle of a conversation.

import { RomajiNotInstalledError, type Tokenizer, setTokenizerLoader } from './core/romaji'
import { type DictProgress, downloadMissing, isInstalled, readAll } from './core/dictionary'
import { dictDeps } from './dictionary-host'

/** Is the whole dictionary stored on this device? */
export const romajiDictionaryInstalled = (): Promise<boolean> => isInstalled(dictDeps())

/** The phone would not keep the downloaded files (they live only until the app closes). */
export const romajiDictionaryVolatile = (): boolean => dictDeps().store.volatile?.() ?? false

/** Download whatever is missing (with progress). Throws a DictionaryError with a message fit to show the user. */
export async function downloadRomajiDictionary(onProgress?: (p: DictProgress) => void): Promise<void> {
  await downloadMissing(dictDeps(), onProgress)
}

/** A sentinel folder: kuromoji asks for "<dicPath>base.dat.gz" etc., and we answer from memory instead of the network. */
const DIC_PATH = '/honyaku-romaji/'

/**
 * kuromoji loads its twelve files with XMLHttpRequest, so for the duration of the build each of those requests is pointed
 * at a blob: URL holding the stored bytes (no network, nothing to whitelist). The patch only touches those URLs and is
 * always undone.
 */
async function withStoredFiles<T>(files: Map<string, ArrayBuffer>, run: () => Promise<T>): Promise<T> {
  const urls = new Map([...files].map(([name, data]) => [name, URL.createObjectURL(new Blob([data]))]))
  const proto = XMLHttpRequest.prototype
  const realOpen = proto.open
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const u = String(url)
    const name = u.startsWith(DIC_PATH) ? u.slice(DIC_PATH.length) : undefined
    return (realOpen as (...a: unknown[]) => void).call(this, method, (name && urls.get(name)) || u, ...rest)
  } as typeof proto.open
  try {
    return await run()
  } finally {
    proto.open = realOpen
    for (const url of urls.values()) URL.revokeObjectURL(url)
  }
}

setTokenizerLoader(async () => {
  const deps = dictDeps()
  if (!(await isInstalled(deps))) throw new RomajiNotInstalledError()
  const files = await readAll(deps)
  const kuromoji = (await import('kuromoji/build/kuromoji.js')).default
  return withStoredFiles(
    files,
    () =>
      new Promise<Tokenizer>((resolve, reject) => {
        kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)))
      }),
  )
})
