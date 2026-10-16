// Per-connection configuration: the user's own API keys, validated and resolved into what the
// STT and translation layers need. Keys live only in the Conn's memory — never logged, never written.
//
// ALLOW_SERVER_KEYS=1 lets a connection fall back to the server's own .env keys for anything the user
// didn't supply (handy in local dev). Without it every user must bring their own keys, so the server
// operator is never billed.

import type { ApiKeys, ListenEngine, Provider, UserConfig } from '../../src/protocol'
import { listenEngine } from './stt'
import { type TranslateConfig, envTranslateConfig } from './translate'

export const serverKeysAllowed = () => /^(1|true|yes)$/i.test(process.env['ALLOW_SERVER_KEYS'] ?? '')

/** Printable ASCII, no spaces: safe to put in a header or URL, and anything else isn't a real key. */
const KEY_RE = /^[\x21-\x7e]{8,400}$/
const MODEL_RE = /^[\w./:-]{1,100}$/

export interface ResolvedConfig {
  deepgramKey?: string
  translate: TranslateConfig
  listenEngine: ListenEngine
  /** Keys that fell back to the server's .env (only when ALLOW_SERVER_KEYS). */
  usingServerKeys: boolean
}

const PROVIDERS: Provider[] = ['google', 'openrouter', 'anthropic']

/** Returns an error message if any supplied key is malformed. */
export function validateConfig(user: UserConfig): string | null {
  for (const [name, value] of Object.entries(user.keys ?? {})) {
    if (value && !KEY_RE.test(value)) return `The ${name} key has invalid characters or length`
  }
  if (user.openrouterModel && !MODEL_RE.test(user.openrouterModel)) return 'Invalid OpenRouter model id'
  if (user.provider && !PROVIDERS.includes(user.provider)) return 'Unknown translation provider'
  return null
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function resolveConfig(user: UserConfig = {}): ResolvedConfig {
  const keys: ApiKeys = user.keys ?? {}
  const env = serverKeysAllowed() ? envTranslateConfig() : undefined
  const envDeepgram = serverKeysAllowed() ? clean(process.env['DEEPGRAM_API_KEY']) : undefined

  const deepgramKey = clean(keys.deepgram) ?? envDeepgram
  const googleKey = clean(keys.google) ?? clean(env?.googleKey)
  const openrouterKey = clean(keys.openrouter) ?? clean(env?.openrouterKey)
  const anthropicKey = clean(keys.anthropic) ?? clean(env?.anthropicKey)

  // Explicit choice wins; otherwise the first provider that has a key.
  const provider: Provider =
    user.provider ?? (googleKey ? 'google' : openrouterKey ? 'openrouter' : anthropicKey ? 'anthropic' : (env?.provider ?? 'google'))

  const usingServerKeys =
    (!clean(keys.deepgram) && !!envDeepgram) ||
    (!clean(keys.google) && !!clean(env?.googleKey)) ||
    (!clean(keys.openrouter) && !!clean(env?.openrouterKey)) ||
    (!clean(keys.anthropic) && !!clean(env?.anthropicKey))

  return {
    deepgramKey,
    translate: {
      provider,
      googleKey,
      openrouterKey,
      openrouterModel: clean(user.openrouterModel) ?? clean(env?.openrouterModel),
      anthropicKey,
      anthropicModel: clean(env?.anthropicModel),
    },
    listenEngine: user.listenEngine ?? listenEngine(),
    usingServerKeys,
  }
}

/** The key the chosen translation provider needs, or undefined if it's missing. */
export function translateKey(cfg: TranslateConfig): string | undefined {
  return cfg.provider === 'google' ? cfg.googleKey : cfg.provider === 'openrouter' ? cfg.openrouterKey : cfg.anthropicKey
}

export function missingKeys(cfg: ResolvedConfig): ('deepgram' | 'translate')[] {
  const missing: ('deepgram' | 'translate')[] = []
  if (!cfg.deepgramKey) missing.push('deepgram')
  if (!translateKey(cfg.translate)) missing.push('translate')
  return missing
}
