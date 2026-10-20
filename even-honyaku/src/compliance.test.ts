// Even Hub submission rules that can be checked by reading the project. They run with `npm test`, so a change that would
// get a build rejected fails here first. The full list of rules (including the ones only a person with a phone and glasses
// can check) is in the workspace's SUBMISSION-CHECKLIST.md. This file is meant to be copied into other Even projects.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Every non-test source file under src/. */
function sources(dir = join(root, 'src')): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sources(path)
    return /\.(ts|html)$/.test(name) && !/\.test\.ts$/.test(name) ? [{ path, text: readFileSync(path, 'utf8') }] : []
  })
}
const code = sources()
const all = code.map((f) => f.text).join('\n')
/** Source with comments removed, so a rule is checked against what runs, not what is written about it. */
const executable = code.map((f) => f.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')).join('\n')

describe('manifest (app.json)', () => {
  it('package_id: reverse-domain, lowercase letters and numbers, no hyphens or underscores, 2+ segments, each starting with a letter', () => {
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  })

  it('edition 202601, three-part version with no prefix or suffix, name of 20 characters or fewer that does not contain "Even"', () => {
    expect(manifest.edition).toBe('202601')
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.name.length).toBeLessThanOrEqual(20)
    expect(manifest.name.toLowerCase()).not.toContain('even')
  })

  it('min_sdk_version is set and is not newer than the SDK the app is built with', () => {
    expect(manifest.min_sdk_version).toMatch(/^\d+\.\d+\.\d+$/)
    const installed = JSON.parse(readFileSync(join(root, 'node_modules/@evenrealities/even_hub_sdk/package.json'), 'utf8')).version
    const n = (v: string) => v.split('.').map(Number)
    const [a, b] = [n(manifest.min_sdk_version), n(installed)]
    expect(a[0]! * 1e6 + a[1]! * 1e3 + a[2]!).toBeLessThanOrEqual(b[0]! * 1e6 + b[1]! * 1e3 + b[2]!)
  })

  it('the SDK is pinned to an exact version (no ^, ~ or "latest"): shipped apps need repeatable builds', () => {
    expect(pkg.dependencies['@evenrealities/even_hub_sdk']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('entrypoint is a real file in the source tree and supported_languages uses allowed codes', () => {
    expect(() => readFileSync(join(root, manifest.entrypoint))).not.toThrow()
    for (const l of manifest.supported_languages) expect(['en', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko']).toContain(l)
  })

  it('permissions are an array of { name, desc } with a 1-300 character reason, from the allowed set', () => {
    expect(Array.isArray(manifest.permissions)).toBe(true)
    for (const p of manifest.permissions) {
      expect(['network', 'location', 'g2-microphone', 'phone-microphone', 'album', 'camera']).toContain(p.name)
      expect(p.desc.length).toBeGreaterThanOrEqual(1)
      expect(p.desc.length).toBeLessThanOrEqual(300)
    }
  })
})

describe('every declared permission is used, and every use is declared (unused ones are flagged at review)', () => {
  const declared = new Set<string>(manifest.permissions.map((p: { name: string }) => p.name))

  it('g2-microphone ↔ audioControl(true, AudioInputSource.Glasses), named explicitly', () => {
    const uses = /audioControl\(\s*true\s*,\s*AudioInputSource\.Glasses\s*\)/.test(executable)
    expect(declared.has('g2-microphone')).toBe(uses)
  })

  it('phone-microphone ↔ AudioInputSource.Phone', () => {
    expect(declared.has('phone-microphone')).toBe(/AudioInputSource\.Phone/.test(executable))
  })

  it('network ↔ fetch / WebSocket', () => {
    expect(declared.has('network')).toBe(/\bfetch\(|new WebSocket\(/.test(executable))
  })

  it('location, album and camera are only declared if their APIs are called', () => {
    expect(declared.has('location')).toBe(/getAppLocation|startAppLocationUpdates/.test(executable))
    expect(declared.has('album')).toBe(/pickImageFromAlbum/.test(executable))
    expect(declared.has('camera')).toBe(/captureImageFromCamera/.test(executable))
  })
})

describe('network: every origin the code talks to is whitelisted (the whitelist is a permission check, not a CORS bypass)', () => {
  const whitelist: string[] = manifest.permissions.find((p: { name: string }) => p.name === 'network')?.whitelist ?? []
  const origins = [...new Set([...executable.matchAll(/\b(https?|wss?):\/\/[a-z0-9.-]+/g)].map((m) => m[0]))].filter((o) => !/w3\.org/.test(o))

  it('finds the services the app really calls', () => {
    expect(origins.length).toBeGreaterThan(0)
  })

  it('each origin used is whitelisted with its own scheme', () => {
    for (const o of origins) expect(whitelist, `${o} is used but not whitelisted`).toContain(o)
  })

  it('the whitelist holds full origins only: no wildcards, no bare hostnames, https/wss in production', () => {
    for (const o of whitelist) expect(o).toMatch(/^(https|wss):\/\/[a-z0-9.-]+$/)
  })

  it('nothing in the whitelist is unused (compared by host: a service reached over wss:// may also list its https:// origin)', () => {
    const hosts = origins.map((o) => o.replace(/^\w+:\/\//, ''))
    for (const o of whitelist) expect(hosts, `${o} is whitelisted but its host is never used`).toContain(o.replace(/^\w+:\/\//, ''))
  })

  it('the page loads nothing from outside the bundle: no external scripts, styles, fonts or images', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).not.toMatch(/(src|href)=["']https?:\/\//)
    expect(readFileSync(join(root, 'src/style.css'), 'utf8')).not.toMatch(/url\(["']?https?:|@import\s+url\(["']?https?:/)
  })
})

describe('package size: Even Hub\'s practical cap is about 10 MB, so nothing big is bundled', () => {
  /** Everything Vite would copy into the package from public/ (bundled JS and CSS are small and measured by the build). */
  const filesIn = (dir: string): number[] => {
    try {
      return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? filesIn(join(dir, n)) : [statSync(join(dir, n)).size]))
    } catch {
      return []
    }
  }

  it('public/ holds no large assets (large optional data is downloaded on demand instead, with a verified hash)', () => {
    const sizes = filesIn(join(root, 'public'))
    expect(Math.max(0, ...sizes)).toBeLessThan(1_000_000)
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(2_000_000)
  })
})

describe('exit: the root page uses the system confirmation dialog', () => {
  // calls only (`bridge.shutDownPageContainer(1)`, `?.shutDownPageContainer(1)`), not a type declaration
  const calls = [...executable.matchAll(/[.?]\s*shutDownPageContainer\(([^)]*)\)/g)].map((m) => m[1]!.trim())

  it('shutDownPageContainer is called, and only ever with mode 1 (mode 0 is for cleanup after the user confirmed)', () => {
    expect(calls.length).toBeGreaterThan(0)
    for (const mode of calls) expect(mode).toBe('1')
  })

  it('there is no custom exit-confirmation UI', () => {
    expect(executable).not.toMatch(/are you sure|confirm exit|exit confirm/i)
  })
})

describe('secrets and logging', () => {
  it('no API key or token is baked into the source', () => {
    expect(all).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
    expect(all).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/)
    expect(all).not.toMatch(/(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_-]{24,}['"]/i)
  })

  it('the app never writes to the console (the beta console is visible to reviewers: no secrets, no transcripts)', () => {
    expect(executable).not.toMatch(/\bconsole\.(log|debug|info|warn|error|trace)\b/)
  })
})

describe('on-glasses display', () => {
  it('declares the contextual menu with a menuObject (carried on every page it builds)', () => {
    const display = readFileSync(join(root, 'src/display.ts'), 'utf8')
    expect(display).toMatch(/menuObject/)
    expect(display).toMatch(/MenuContainerProperty/)
  })

  it('shows the app name from the manifest on the glasses (the on-glasses name must match the store name)', () => {
    expect(readFileSync(join(root, 'src/display.ts'), 'utf8')).toContain(manifest.name)
  })

  it('renders no emoji on the glasses (the font has none; arrows, circles and stars are fine)', () => {
    const display = readFileSync(join(root, 'src/display.ts'), 'utf8') + readFileSync(join(root, 'src/predictive.ts'), 'utf8')
    expect(display).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })
})

describe('privacy policy', () => {
  it('exists and mentions every declared permission and every whitelisted service', () => {
    const policy = readFileSync(join(root, 'PRIVACY.md'), 'utf8').toLowerCase()
    for (const p of manifest.permissions) expect(policy, `PRIVACY.md should cover ${p.name}`).toContain(p.name)
    const net = manifest.permissions.find((p: { name: string }) => p.name === 'network')
    for (const o of net?.whitelist ?? []) {
      const host = o.replace(/^\w+:\/\//, '')
      expect(policy, `PRIVACY.md should name ${host}`).toContain(host.replace(/^api\./, '').split('.')[0]!)
    }
  })
})
