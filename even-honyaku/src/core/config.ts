// A user's configuration — their own API keys and choices — validated and resolved into what the STT and
// translation layers need. Pure (no env, no I/O), so it runs in the app and on the server alike.
// Keys are never logged or persisted here.

import type { ApiKeys, ListenEngine, Provider, UserConfig } from '../protocol'
import { DEEPGRAM_KEY_RE } from './stt'
import type { TranslateConfig } from './translate'

/** Keys the host (server .env) offers when a user didn't bring their own. Only ever set on the server. */
export interface Fallback {
  deepgramKey?: string
  translate?: Partial<TranslateConfig>
  listenEngine?: ListenEngine
}

/** Printable ASCII, no spaces: safe to put in a header or URL, and anything else isn't a real key. */
const KEY_RE = /^[\x21-\x7e]{8,400}$/
const MODEL_RE = /^[\w./:-]{1,100}$/
const PROVIDERS: Provider[] = ['google', 'openrouter', 'anthropic']

export interface ResolvedConfig {
  deepgramKey?: string
  translate: TranslateConfig
  listenEngine: ListenEngine
  /** Some key fell back to the host's own (server .env). */
  usingServerKeys: boolean
}

/** Returns an error message if any supplied key is malformed. */
export function validateConfig(user: UserConfig): string | null {
  for (const [name, value] of Object.entries(user.keys ?? {})) {
    if (!value) continue
    if (name === 'deepgram' ? !DEEPGRAM_KEY_RE.test(value) : !KEY_RE.test(value)) return `The ${name} key has invalid characters or length`
  }
  if (user.openrouterModel && !MODEL_RE.test(user.openrouterModel)) return 'Invalid OpenRouter model id'
  if (user.provider && !PROVIDERS.includes(user.provider)) return 'Unknown translation provider'
  return null
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function resolveConfig(user: UserConfig = {}, fallback?: Fallback): ResolvedConfig {
  const keys: ApiKeys = user.keys ?? {}
  const fb = fallback?.translate

  const deepgramKey = clean(keys.deepgram) ?? clean(fallback?.deepgramKey)
  const googleKey = clean(keys.google) ?? clean(fb?.googleKey)
  const openrouterKey = clean(keys.openrouter) ?? clean(fb?.openrouterKey)
  const anthropicKey = clean(keys.anthropic) ?? clean(fb?.anthropicKey)

  // Explicit choice wins; otherwise the first provider that has a key.
  const provider: Provider =
    user.provider ?? (googleKey ? 'google' : openrouterKey ? 'openrouter' : anthropicKey ? 'anthropic' : (fb?.provider ?? 'google'))

  const usingServerKeys =
    (!clean(keys.deepgram) && !!clean(fallback?.deepgramKey)) ||
    (!clean(keys.google) && !!clean(fb?.googleKey)) ||
    (!clean(keys.openrouter) && !!clean(fb?.openrouterKey)) ||
    (!clean(keys.anthropic) && !!clean(fb?.anthropicKey))

  return {
    deepgramKey,
    translate: {
      provider,
      googleKey,
      openrouterKey,
      openrouterModel: clean(user.openrouterModel) ?? clean(fb?.openrouterModel),
      anthropicKey,
      anthropicModel: clean(fb?.anthropicModel),
    },
    listenEngine: user.listenEngine ?? fallback?.listenEngine ?? 'dual',
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
