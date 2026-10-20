import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DICT_FILES, DICT_PACKAGE, DICT_VERSION } from './dictionary-manifest'
import { DICT_BASE_URL } from './dictionary-host'

const root = new URL('..', import.meta.url).pathname
const pkgDir = join(root, 'node_modules', DICT_PACKAGE)

describe('dictionary manifest', () => {
  it('lists exactly the files, sizes and SHA-256 hashes of the installed package (run `npm run dict:manifest` if this fails)', () => {
    const onDisk = readdirSync(join(pkgDir, 'dict')).filter((f) => f.endsWith('.dat.gz')).sort()
    expect(DICT_FILES.map((f) => f.name)).toEqual(onDisk)
    for (const f of DICT_FILES) {
      const data = readFileSync(join(pkgDir, 'dict', f.name))
      expect(data.length, f.name).toBe(f.bytes)
      expect(createHash('sha256').update(data).digest('hex'), f.name).toBe(f.sha256)
    }
  })

  it('is for the kuromoji version package.json pins exactly, so the CDN folder can never serve a different one', () => {
    expect(JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version).toBe(DICT_VERSION)
    const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies[DICT_PACKAGE]
    expect(pinned).toBe(DICT_VERSION)
  })

  it('downloads from an https CDN folder pinned to that exact version', () => {
    expect(DICT_BASE_URL).toBe(`https://cdn.jsdelivr.net/npm/kuromoji@${DICT_VERSION}/dict/`)
  })

  it('is the whole dictionary: twelve files, about 18 MB', () => {
    expect(DICT_FILES).toHaveLength(12)
    expect(DICT_FILES.reduce((n, f) => n + f.bytes, 0)).toBeGreaterThan(17e6)
    expect(DICT_FILES.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)
  })
})
