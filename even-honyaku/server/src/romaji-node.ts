// Node host for the romaji dictionary: read it straight from the kuromoji package on disk.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import kuromoji from 'kuromoji'
import { setTokenizerLoader } from '../../src/core/romaji'

setTokenizerLoader(
  () =>
    new Promise((resolve, reject) => {
      const dicPath = join(dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict')
      kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)))
    }),
)
