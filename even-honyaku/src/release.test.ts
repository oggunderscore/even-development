import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const json = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
const manifest = json('app.json')

describe('release manifest', () => {
  it('shares one version between app.json, package.json and the footer', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(json('package.json').version).toBe(manifest.version)
    expect(__APP_VERSION__).toBe(manifest.version)
  })

  it('meets the Even Hub store rules', () => {
    expect(manifest.name.length).toBeLessThanOrEqual(20)
    expect(manifest.name.toLowerCase()).not.toContain('even')
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
    for (const p of manifest.permissions) {
      expect(p.desc.length).toBeGreaterThanOrEqual(1)
      expect(p.desc.length).toBeLessThanOrEqual(300)
    }
  })

  it('whitelists only the HTTPS/WSS origins the engine talks to', () => {
    const net = manifest.permissions.find((p: { name: string }) => p.name === 'network')
    for (const origin of net.whitelist) expect(origin).toMatch(/^(https|wss):\/\/[a-z0-9.-]+$/)
    expect(net.whitelist).toContain('wss://api.deepgram.com')
  })
})
