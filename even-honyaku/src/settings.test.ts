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

  it('conversation settings default to the classic behaviour and survive a round trip', () => {
    const d = defaultSettings()
    expect(d).toMatchObject({ mode: 'standard', replyStyle: 'polite', jpLevel: 'beginner', maxOptions: 3, voiceFilter: true, voiceStrictness: 0.5, glassesKana: false })
    const s = { ...d, mode: 'predictive' as const, replyStyle: 'casual' as const, jpLevel: 'advanced' as const, maxOptions: 2 as const, voiceFilter: false, voiceStrictness: 0.8, glassesKana: true }
    expect(parseSettings(JSON.stringify(s))).toEqual(s)
  })

  it('bad conversation values fall back or clamp', () => {
    const p = parseSettings(JSON.stringify({ mode: 'turbo', replyStyle: 7, jpLevel: 'god', maxOptions: 9, voiceFilter: 'yes', voiceStrictness: 4, glassesKana: 1 }))!
    expect(p).toMatchObject({ mode: 'standard', replyStyle: 'polite', jpLevel: 'beginner', maxOptions: 3, voiceFilter: true, voiceStrictness: 1, glassesKana: false })
    expect(parseSettings(JSON.stringify({ voiceStrictness: -3 }))!.voiceStrictness).toBe(0)
  })

  it('toUserConfig hands the engine the predict and voice settings, plus the voiceprint', () => {
    const profile = { v: 1 as const, updated: 1, en: { seed: [], adapt: [] }, ja: { seed: [], adapt: [] } }
    const cfg = toUserConfig({ ...defaultSettings(), mode: 'predictive', maxOptions: 2, voiceStrictness: 0.7 }, profile)
    expect(cfg.predict).toEqual({ enabled: true, style: 'polite', level: 'beginner', maxOptions: 2 })
    expect(cfg.voice).toEqual({ filter: true, strictness: 0.7, profile })
    expect(toUserConfig(defaultSettings()).predict?.enabled).toBe(false)
  })
})
