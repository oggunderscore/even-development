// User settings: the user's own API keys and their choices. Everything stays on the device (bridge localStorage,
// mirrored to the browser's localStorage) and is only ever sent to Deepgram and the translation provider the user
// picked — straight from the phone.

import type { ApiKeys, AppMode, JpLevel, Provider, ReplyStyle, UserConfig, VoiceProfile } from './protocol'

export interface Settings {
  deepgramKey: string
  provider: Provider
  googleKey: string
  openrouterKey: string
  anthropicKey: string
  openrouterModel: string
  /** Standard translation feed, or Predictive Conversation Mode (suggested replies). */
  mode: AppMode
  replyStyle: ReplyStyle
  jpLevel: JpLevel
  maxOptions: 2 | 3
  /** Keep the wearer's own voice out of the conversation. */
  voiceFilter: boolean
  /** 0..1 — how readily a voice is called the wearer's. */
  voiceStrictness: number
  /** Also draw kana/kanji on the glasses (romaji is always drawn). */
  glassesKana: boolean
}

export const STORAGE_KEY = 'honyaku.settings.v1'

export const defaultSettings = (): Settings => ({
  deepgramKey: '',
  provider: 'google',
  googleKey: '',
  openrouterKey: '',
  anthropicKey: '',
  openrouterModel: '',
  mode: 'standard',
  replyStyle: 'polite',
  jpLevel: 'beginner',
  maxOptions: 3,
  voiceFilter: true,
  voiceStrictness: 0.5,
  glassesKana: false,
})

const PROVIDERS: Provider[] = ['google', 'openrouter', 'anthropic']

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

/** Parse stored JSON defensively: unknown fields (e.g. from older versions) are dropped, wrong types fall back. */
export function parseSettings(raw: string | null | undefined): Settings | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const d = defaultSettings()
    const str = (k: keyof Settings) => (typeof o[k] === 'string' ? (o[k] as string) : '')
    return {
      deepgramKey: str('deepgramKey'),
      provider: PROVIDERS.includes(o['provider'] as Provider) ? (o['provider'] as Provider) : d.provider,
      googleKey: str('googleKey'),
      openrouterKey: str('openrouterKey'),
      anthropicKey: str('anthropicKey'),
      openrouterModel: str('openrouterModel'),
      mode: pick(o['mode'], ['standard', 'predictive'], d.mode),
      replyStyle: pick(o['replyStyle'], ['polite', 'casual'], d.replyStyle),
      jpLevel: pick(o['jpLevel'], ['beginner', 'intermediate', 'advanced'], d.jpLevel),
      maxOptions: o['maxOptions'] === 2 ? 2 : 3,
      voiceFilter: typeof o['voiceFilter'] === 'boolean' ? o['voiceFilter'] : d.voiceFilter,
      voiceStrictness: typeof o['voiceStrictness'] === 'number' && Number.isFinite(o['voiceStrictness']) ? Math.min(1, Math.max(0, o['voiceStrictness'])) : d.voiceStrictness,
      glassesKana: typeof o['glassesKana'] === 'boolean' ? o['glassesKana'] : d.glassesKana,
    }
  } catch {
    return null
  }
}

/** What the engine needs — empty keys are omitted so "no key" can never be mistaken for a key. */
export function toUserConfig(s: Settings, profile: VoiceProfile | null = null): UserConfig {
  const keys: ApiKeys = {}
  if (s.deepgramKey.trim()) keys.deepgram = s.deepgramKey.trim()
  if (s.googleKey.trim()) keys.google = s.googleKey.trim()
  if (s.openrouterKey.trim()) keys.openrouter = s.openrouterKey.trim()
  if (s.anthropicKey.trim()) keys.anthropic = s.anthropicKey.trim()
  return {
    keys,
    provider: s.provider,
    openrouterModel: s.openrouterModel.trim() || undefined,
    predict: { enabled: s.mode === 'predictive', style: s.replyStyle, level: s.jpLevel, maxOptions: s.maxOptions },
    voice: { filter: s.voiceFilter, strictness: s.voiceStrictness, profile },
  }
}

const keyFor = (s: Settings, p: Provider) => (p === 'google' ? s.googleKey : p === 'openrouter' ? s.openrouterKey : s.anthropicKey).trim()

export const providerKey = (s: Settings): string => keyFor(s, s.provider)

/**
 * If the chosen provider has no key but another does, switch to it — someone who pasted only an OpenRouter key
 * shouldn't have to also flip the provider toggle.
 */
export function normalizeSettings(s: Settings): Settings {
  if (providerKey(s)) return s
  const available = PROVIDERS.find((p) => keyFor(s, p))
  return available ? { ...s, provider: available } : s
}

/** Both keys the app needs are present. */
export const hasKeys = (s: Settings): boolean => !!s.deepgramKey.trim() && !!providerKey(s)

export type SetupStep = { id: 'deepgram' | 'translate'; done: boolean }

/** The two things first-run setup needs, and whether each is done. */
export function setupSteps(s: Settings): SetupStep[] {
  return [
    { id: 'deepgram', done: !!s.deepgramKey.trim() },
    { id: 'translate', done: !!providerKey(s) },
  ]
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
