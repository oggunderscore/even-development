// Checks that API keys actually work. Used by the in-app "Test connection" button and by the startup
// self-check when the server has its own keys (ALLOW_SERVER_KEYS). Never includes a key in its output.

import type { Provider, TestResult } from '../../src/protocol'
import { type ResolvedConfig, translateKey } from './config'
import { translate } from './translate'

async function probe(service: TestResult['service'], url: string, headers: Record<string, string>): Promise<TestResult> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(7000) })
    if (res.ok) return { service, ok: true, detail: 'key valid' }
    if (res.status === 401 || res.status === 403 || res.status === 400)
      return { service, ok: false, detail: `key rejected (HTTP ${res.status})` }
    return { service, ok: false, detail: `unexpected HTTP ${res.status}` }
  } catch (err) {
    return { service, ok: false, detail: `unreachable (${err instanceof Error ? err.message : 'network error'})` }
  }
}

function providerProbe(provider: Provider, key: string): Promise<TestResult> {
  switch (provider) {
    case 'google':
      return probe('google', `https://translation.googleapis.com/language/translate/v2/languages?key=${encodeURIComponent(key)}`, {})
    case 'openrouter':
      return probe('openrouter', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })
    case 'anthropic':
      return probe('anthropic', 'https://api.anthropic.com/v1/models', { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
  }
}

export async function testConfig(cfg: ResolvedConfig): Promise<TestResult[]> {
  const tKey = translateKey(cfg.translate)
  const [stt, provider] = await Promise.all([
    cfg.deepgramKey
      ? probe('deepgram', 'https://api.deepgram.com/v1/auth/token', { Authorization: `Token ${cfg.deepgramKey}` })
      : Promise.resolve<TestResult>({ service: 'deepgram', ok: false, detail: 'no key set' }),
    tKey
      ? providerProbe(cfg.translate.provider, tKey)
      : Promise.resolve<TestResult>({ service: cfg.translate.provider, ok: false, detail: 'no key set' }),
  ])
  const results = [stt, provider]

  // End-to-end: only worth a call if the provider's key was accepted.
  if (provider.ok) {
    try {
      const t = await translate('speak', 'How much is this?', [], 0, cfg.translate)
      results.push({ service: 'translate', ok: true, detail: `"How much is this?" → ${t.romaji}` })
    } catch (err) {
      results.push({ service: 'translate', ok: false, detail: err instanceof Error ? err.message.slice(0, 140) : 'failed' })
    }
  }
  return results
}
