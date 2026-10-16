// Server-only: the host's own keys from .env, offered to users who didn't bring their own — but only when
// ALLOW_SERVER_KEYS is on, so by default whoever runs this server is never billed.

import type { Provider } from '../../src/protocol'
import type { Fallback } from '../../src/core/config'
import { listenEngine } from '../../src/core/stt'
import type { TranslateConfig } from '../../src/core/translate'

export const serverKeysAllowed = () => /^(1|true|yes)$/i.test(process.env['ALLOW_SERVER_KEYS'] ?? '')

export function envTranslateConfig(): TranslateConfig {
  const env = process.env
  return {
    provider: (env['TRANSLATE_PROVIDER'] as Provider) || (env['GOOGLE_TRANSLATE_API_KEY'] ? 'google' : 'openrouter'),
    googleKey: env['GOOGLE_TRANSLATE_API_KEY'],
    openrouterKey: env['OPENROUTER_API_KEY'],
    openrouterModel: env['OPENROUTER_MODEL'],
    anthropicKey: env['ANTHROPIC_API_KEY'],
    anthropicModel: env['ANTHROPIC_MODEL'],
  }
}

/** undefined unless ALLOW_SERVER_KEYS is on. */
export function serverFallback(): Fallback | undefined {
  if (!serverKeysAllowed()) return undefined
  return {
    deepgramKey: process.env['DEEPGRAM_API_KEY'],
    translate: envTranslateConfig(),
    listenEngine: listenEngine(process.env['LISTEN_ENGINE']),
  }
}
