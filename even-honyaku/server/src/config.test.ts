import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { missingKeys, resolveConfig, validateConfig } from './config'

describe('per-connection config', () => {
  beforeEach(() => {
    vi.stubEnv('ALLOW_SERVER_KEYS', '')
    vi.stubEnv('DEEPGRAM_API_KEY', 'server-deepgram-key')
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', 'server-google-key')
    vi.stubEnv('OPENROUTER_API_KEY', 'server-openrouter-key')
    vi.stubEnv('TRANSLATE_PROVIDER', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it("never falls back to the server's own keys unless ALLOW_SERVER_KEYS is on", () => {
    const cfg = resolveConfig({})
    expect(cfg.deepgramKey).toBeUndefined()
    expect(cfg.translate.googleKey).toBeUndefined()
    expect(missingKeys(cfg)).toEqual(['deepgram', 'translate'])
    expect(cfg.usingServerKeys).toBe(false)
  })

  it('uses the keys the user supplied', () => {
    const cfg = resolveConfig({ keys: { deepgram: 'dg-user-key-123', google: 'g-user-key-1234' } })
    expect(cfg.deepgramKey).toBe('dg-user-key-123')
    expect(cfg.translate).toMatchObject({ provider: 'google', googleKey: 'g-user-key-1234' })
    expect(missingKeys(cfg)).toEqual([])
    expect(cfg.usingServerKeys).toBe(false)
  })

  it('picks the provider that has a key, unless the user chose one', () => {
    expect(resolveConfig({ keys: { openrouter: 'or-user-key-123' } }).translate.provider).toBe('openrouter')
    const chosen = resolveConfig({ provider: 'anthropic', keys: { google: 'g-user-key-1234' } })
    expect(chosen.translate.provider).toBe('anthropic')
    expect(missingKeys(chosen)).toEqual(['deepgram', 'translate']) // chosen provider has no key
  })

  it('falls back to server keys per key, only when allowed', () => {
    vi.stubEnv('ALLOW_SERVER_KEYS', '1')
    const cfg = resolveConfig({ keys: { deepgram: 'dg-user-key-123' } })
    expect(cfg.deepgramKey).toBe('dg-user-key-123') // user's own wins
    expect(cfg.translate.googleKey).toBe('server-google-key')
    expect(cfg.usingServerKeys).toBe(true)
  })

  it('trims blanks and treats empty strings as missing', () => {
    expect(resolveConfig({ keys: { deepgram: '   ' } }).deepgramKey).toBeUndefined()
    expect(resolveConfig({ keys: { deepgram: '  dg-user-key-123  ' } }).deepgramKey).toBe('dg-user-key-123')
  })

  it('rejects malformed keys (header/URL injection, junk)', () => {
    expect(validateConfig({ keys: { deepgram: 'abc\r\nX-Evil: 1' } })).toMatch(/deepgram/)
    expect(validateConfig({ keys: { google: 'has space in it' } })).toMatch(/google/)
    expect(validateConfig({ keys: { openrouter: 'short' } })).toMatch(/openrouter/)
    expect(validateConfig({ openrouterModel: 'a b; rm -rf' })).toMatch(/model/)
    expect(validateConfig({ provider: 'bogus' as never })).toMatch(/provider/)
    expect(validateConfig({ keys: { deepgram: 'dg-user-key-123' }, openrouterModel: 'google/gemini-2.5-flash-lite' })).toBeNull()
  })
})
