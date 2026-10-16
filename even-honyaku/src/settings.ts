// User settings: server address, the user's own API keys and their choices. Everything stays on the device
// (bridge localStorage, mirrored to the browser's localStorage) and is only ever sent to the server the user
// configured, over the WebSocket, in the `config` message.

import type { ApiKeys, ListenEngine, Provider, UserConfig } from './protocol'
import { SERVER_URL } from './config'

/** direct: the app calls Deepgram + the translation provider itself. server: via your own proxy (server/). */
export type Mode = 'direct' | 'server'

export interface Settings {
  mode: Mode
  serverUrl: string
  serverToken: string
  deepgramKey: string
  provider: Provider
  googleKey: string
  openrouterKey: string
  anthropicKey: string
  openrouterModel: string
  listenEngine: ListenEngine
}

export const STORAGE_KEY = 'honyaku.settings.v1'

export const defaultSettings = (): Settings => ({
  mode: 'direct',
  serverUrl: SERVER_URL,
  serverToken: '',
  deepgramKey: '',
  provider: 'google',
  googleKey: '',
  openrouterKey: '',
  anthropicKey: '',
  openrouterModel: '',
  listenEngine: 'dual',
})

const PROVIDERS: Provider[] = ['google', 'openrouter', 'anthropic']
const ENGINES: ListenEngine[] = ['dual', 'ja', 'multi']

/** Parse stored JSON defensively: unknown fields are dropped, wrong types fall back to defaults. */
export function parseSettings(raw: string | null | undefined): Settings | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const d = defaultSettings()
    const str = (k: keyof Settings, fallback: string) => (typeof o[k] === 'string' ? (o[k] as string) : fallback)
    return {
      mode: o['mode'] === 'server' ? 'server' : 'direct',
      serverUrl: str('serverUrl', d.serverUrl).trim() || d.serverUrl,
      serverToken: str('serverToken', d.serverToken),
      deepgramKey: str('deepgramKey', ''),
      provider: PROVIDERS.includes(o['provider'] as Provider) ? (o['provider'] as Provider) : d.provider,
      googleKey: str('googleKey', ''),
      openrouterKey: str('openrouterKey', ''),
      anthropicKey: str('anthropicKey', ''),
      openrouterModel: str('openrouterModel', ''),
      listenEngine: ENGINES.includes(o['listenEngine'] as ListenEngine) ? (o['listenEngine'] as ListenEngine) : d.listenEngine,
    }
  } catch {
    return null
  }
}

/** What the server needs — empty keys are omitted so "no key" can never be mistaken for a key. */
export function toUserConfig(s: Settings): UserConfig {
  const keys: ApiKeys = {}
  if (s.deepgramKey.trim()) keys.deepgram = s.deepgramKey.trim()
  if (s.googleKey.trim()) keys.google = s.googleKey.trim()
  if (s.openrouterKey.trim()) keys.openrouter = s.openrouterKey.trim()
  if (s.anthropicKey.trim()) keys.anthropic = s.anthropicKey.trim()
  return {
    token: s.serverToken || undefined,
    keys,
    provider: s.provider,
    openrouterModel: s.openrouterModel.trim() || undefined,
    listenEngine: s.listenEngine,
  }
}

export function providerKey(s: Settings): string {
  return (s.provider === 'google' ? s.googleKey : s.provider === 'openrouter' ? s.openrouterKey : s.anthropicKey).trim()
}

/** Both keys the app needs are present locally (the server may additionally have its own fallback keys). */
export const hasKeys = (s: Settings): boolean => !!s.deepgramKey.trim() && !!providerKey(s)

/** Never show a stored key in full. */
export function maskKey(key: string): string {
  const k = key.trim()
  if (!k) return 'not set'
  return k.length <= 8 ? '••••' : `••••${k.slice(-4)}`
}

/**
 * Keys travel over the WebSocket, so plain ws:// is only acceptable on a network that is private or
 * already encrypted: loopback, RFC1918 LAN, Tailscale (100.64/10, *.ts.net) or mDNS (*.local). wss:// is always fine.
 */
export function isSecureEnough(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'wss:') return true
  if (u.protocol !== 'ws:') return false
  const h = u.hostname.replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.ts.net')) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)
}

// ── persistence ──────────────────────────────────────────────────────────────

type BridgeStorage = { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> }

function readLocal(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Synchronous load for first paint: browser localStorage only. */
export function loadSettings(): Settings {
  return parseSettings(readLocal()) ?? defaultSettings()
}

/** The bridge store survives reinstalls of the page; prefer it, fall back to (and re-seed from) localStorage. */
export async function loadSettingsFromBridge(bridge: BridgeStorage): Promise<Settings> {
  try {
    const fromBridge = parseSettings(await bridge.getLocalStorage(STORAGE_KEY))
    if (fromBridge) return fromBridge
  } catch {
    /* fall through to localStorage */
  }
  const local = parseSettings(readLocal())
  if (local) void bridge.setLocalStorage(STORAGE_KEY, JSON.stringify(local)).catch(() => {})
  return local ?? defaultSettings()
}

export async function saveSettings(s: Settings, bridge?: BridgeStorage | null): Promise<void> {
  const json = JSON.stringify(s)
  try {
    localStorage.setItem(STORAGE_KEY, json)
  } catch {
    /* private mode etc. */
  }
  await bridge?.setLocalStorage(STORAGE_KEY, json).catch(() => {})
}

/** Wipe every key and the stored copy; keep the server address and token so the app can still connect. */
export function withoutKeys(s: Settings): Settings {
  return { ...s, deepgramKey: '', googleKey: '', openrouterKey: '', anthropicKey: '', openrouterModel: '' }
}
