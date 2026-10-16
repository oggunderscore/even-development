import { describe, expect, it } from 'vitest'
import { defaultSettings, hasKeys, isSecureEnough, maskKey, parseSettings, toUserConfig, withoutKeys } from './settings'

describe('settings', () => {
  it('round-trips and ignores junk', () => {
    const s = { ...defaultSettings(), deepgramKey: 'dg', provider: 'openrouter' as const }
    expect(parseSettings(JSON.stringify(s))).toEqual(s)
    expect(parseSettings('not json')).toBeNull()
    expect(parseSettings(JSON.stringify({ provider: 'evil', listenEngine: 5, deepgramKey: 7 }))).toMatchObject({
      provider: 'google',
      listenEngine: 'dual',
      deepgramKey: '',
    })
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

  it('masks keys', () => {
    expect(maskKey('')).toBe('not set')
    expect(maskKey('abcd')).toBe('••••')
    expect(maskKey('abcdefghijkl')).toBe('••••ijkl')
  })

  it('withoutKeys keeps the connection details', () => {
    const s = { ...defaultSettings(), serverUrl: 'wss://x.example', serverToken: 't', deepgramKey: 'dg', googleKey: 'g' }
    expect(withoutKeys(s)).toMatchObject({ serverUrl: 'wss://x.example', serverToken: 't', deepgramKey: '', googleKey: '' })
  })
})

describe('isSecureEnough (keys must not cross a public network in cleartext)', () => {
  it.each([
    'wss://honyaku.example.com',
    'ws://localhost:8787',
    'ws://127.0.0.1:8787',
    'ws://192.168.1.50:8787',
    'ws://10.139.60.176:8787',
    'ws://172.20.0.5:8787',
    'ws://100.95.240.35:8787',
    'ws://my-mac.tail5ea12a.ts.net:8787',
    'ws://mac.local:8787',
  ])('allows %s', (u) => expect(isSecureEnough(u)).toBe(true))
  it.each(['ws://8.8.8.8:8787', 'ws://example.com', 'ws://172.32.0.1', 'ws://100.128.0.1', 'http://localhost', 'garbage', ''])(
    'blocks %s',
    (u) => expect(isSecureEnough(u)).toBe(false),
  )
})
