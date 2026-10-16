// Browser host for the romaji dictionary: fetch the kuromoji dictionary files bundled with the app (public/dict).
// Imported lazily, and only when the Google provider needs it, so the ~17 MB isn't touched otherwise.

import { type Tokenizer, setTokenizerLoader } from './core/romaji'

/**
 * kuromoji requests "<dicPath>base.dat.gz" etc. and gunzips the bytes itself. We ship those files as
 * "<name>.gz.bin" (see scripts/copy-dict.mjs) so no host can transparently decompress them, and redirect
 * kuromoji's requests for the duration of the load. The patch is scoped to dictionary URLs and always undone.
 */
async function withDictionaryRedirect<T>(dicPath: string, run: () => Promise<T>): Promise<T> {
  const proto = XMLHttpRequest.prototype
  const realOpen = proto.open
  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const u = String(url)
    const target = u.startsWith(dicPath) && u.endsWith('.dat.gz') ? `${u}.bin` : u
    return (realOpen as (...a: unknown[]) => void).call(this, method, target, ...rest)
  } as typeof proto.open
  try {
    return await run()
  } finally {
    proto.open = realOpen
  }
}

setTokenizerLoader(async () => {
  const kuromoji = (await import('kuromoji/build/kuromoji.js')).default
  // A path, not a full URL: kuromoji's browser path.join collapses the "//" in "https://" and breaks the request.
  const dicPath = new URL('dict/', document.baseURI).pathname
  return withDictionaryRedirect(
    dicPath,
    () =>
      new Promise<Tokenizer>((resolve, reject) => {
        kuromoji.builder({ dicPath }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)))
      }),
  )
})
