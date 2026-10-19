// A user's configuration — their own API keys and choices — validated and resolved into what the STT and
// translation layers need. Pure (no env, no I/O). Keys are never logged or persisted here.

import type { ApiKeys, Provider, UserConfig } from '../protocol'
import { DEEPGRAM_KEY_RE } from './stt'
import type { TranslateConfig } from './translate'

/** Printable ASCII, no spaces: safe to put in a header or URL, and anything else isn't a real key. */
const KEY_RE = /^[\x21-\x7e]{8,400}$/
const MODEL_RE = /^[\w./:-]{1,100}$/
const PROVIDERS: Provider[] = ['google', 'openrouter', 'anthropic']

export interface ResolvedConfig {
  deepgramKey?: string
  translate: TranslateConfig
}

/** Why a key can't be real (wrong characters or length), or null if it is plausible. Empty is fine: it means "no key". */
export function keyProblem(name: keyof ApiKeys, value: string | undefined): string | null {
  if (!value) return null
  return (name === 'deepgram' ? DEEPGRAM_KEY_RE.test(value) : KEY_RE.test(value)) ? null : `The ${name} key has invalid characters or length`
}

/** Returns an error message if any supplied key is malformed. */
export function validateConfig(user: UserConfig): string | null {
  for (const [name, value] of Object.entries(user.keys ?? {})) {
    const problem = keyProblem(name as keyof ApiKeys, value)
    if (problem) return problem
  }
  if (user.openrouterModel && !MODEL_RE.test(user.openrouterModel)) return 'Invalid OpenRouter model id'
  if (user.anthropicModel && !MODEL_RE.test(user.anthropicModel)) return 'Invalid Claude model id'
  if (user.provider && !PROVIDERS.includes(user.provider)) return 'Unknown translation provider'
  return null
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

export function resolveConfig(user: UserConfig = {}): ResolvedConfig {
  const keys: ApiKeys = user.keys ?? {}
  const deepgramKey = clean(keys.deepgram)
  const googleKey = clean(keys.google)
  const openrouterKey = clean(keys.openrouter)
  const anthropicKey = clean(keys.anthropic)

  // Explicit choice wins; otherwise the first provider that has a key.
  const provider: Provider = user.provider ?? (googleKey ? 'google' : openrouterKey ? 'openrouter' : anthropicKey ? 'anthropic' : 'google')

  return {
    deepgramKey,
    translate: { provider, googleKey, openrouterKey, openrouterModel: clean(user.openrouterModel), anthropicKey, anthropicModel: clean(user.anthropicModel) },
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
