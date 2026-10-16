import { describe, expect, it } from 'vitest'
import { defaultSettings, hasKeys, normalizeSettings, parseSettings, setupSteps, toUserConfig } from './settings'

describe('settings', () => {
  it('round-trips and ignores junk or fields from older versions', () => {
    const s = { ...defaultSettings(), deepgramKey: 'dg', provider: 'openrouter' as const }
    expect(parseSettings(JSON.stringify(s))).toEqual(s)
    expect(parseSettings('not json')).toBeNull()
    expect(parseSettings(JSON.stringify({ provider: 'evil', deepgramKey: 7, serverUrl: 'ws://x', mode: 'server' }))).toEqual(defaultSettings())
  })

  it('toUserConfig omits empty keys and trims', () => {
    const cfg = toUserConfig({ ...defaultSettings(), deepgramKey: '  dg-key  ', googleKey: '' })
    expect(cfg.keys).toEqual({ deepgram: 'dg-key' })
  })

  it('hasKeys needs Deepgram plus the chosen provider', () => {
    const s = { ...defaultSettings(), deepgramKey: 'dg', provider: 'google' as const }
    expect(hasKeys(s)).toBe(false)
    expect(hasKeys({ ...s, googleKey: 'g' })).toBe(true)
    expect(hasKeys({ ...s, provider: 'openrouter', googleKey: 'g' })).toBe(false)
  })

  it('switches to whichever provider has a key when the chosen one has none', () => {
    const s = { ...defaultSettings(), deepgramKey: 'dg', openrouterKey: 'or-key' } // provider defaults to google
    expect(normalizeSettings(s).provider).toBe('openrouter')
    expect(hasKeys(normalizeSettings(s))).toBe(true)
    // an explicit, satisfied choice is left alone
    expect(normalizeSettings({ ...s, googleKey: 'g' }).provider).toBe('google')
    // nothing to switch to
    expect(normalizeSettings(defaultSettings()).provider).toBe('google')
  })

  it('setupSteps reports what is still missing', () => {
    expect(setupSteps(defaultSettings())).toEqual([{ id: 'deepgram', done: false }, { id: 'translate', done: false }])
    expect(setupSteps({ ...defaultSettings(), deepgramKey: 'dg', googleKey: 'g' }).every((x) => x.done)).toBe(true)
  })

})
