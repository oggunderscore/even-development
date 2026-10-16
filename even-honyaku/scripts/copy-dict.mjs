// Copies the kuromoji dictionary (~17 MB of .dat.gz) into public/dict so Vite ships it with the app.
// The Google-Translate path needs it for romaji; it's only fetched when that provider is actually used.
//
// Files get a ".bin" suffix (base.dat.gz → base.dat.gz.bin): some static hosts, including Vite's dev server,
// answer *.gz with "Content-Encoding: gzip", so the WebView would hand kuromoji already-decompressed bytes and
// its own gunzip would fail. src/romaji-browser.ts requests the .bin names, which every host serves untouched.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'kuromoji', 'dict')
const dest = join(root, 'public', 'dict')

if (!existsSync(src)) {
  console.error('kuromoji dictionary not found — run `npm install` first')
  process.exit(1)
}
if (!existsSync(join(dest, 'base.dat.gz.bin'))) {
  mkdirSync(dest, { recursive: true })
  for (const f of readdirSync(src)) if (f.endsWith('.dat.gz')) copyFileSync(join(src, f), join(dest, `${f}.bin`))
  console.log('copied kuromoji dictionary → public/dict')
}
