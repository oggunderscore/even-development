// Checks that API keys actually work — the Settings tab's "SAVE & TEST". Output never contains a key.

import type { Provider, TestResult } from '../protocol'
import { type ResolvedConfig, translateKey } from './config'
import { deepgramUrl } from './stt'
import { translate } from './translate'
import { loadRomajiDictionary } from './romaji'

const TIMEOUT_MS = 8000

async function probeHttp(service: TestResult['service'], url: string, headers: Record<string, string>): Promise<TestResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    if (res.ok) return { service, ok: true, detail: 'key valid' }
    if (res.status === 401 || res.status === 403 || res.status === 400) return { service, ok: false, detail: `key rejected (HTTP ${res.status})` }
    return { service, ok: false, detail: `unexpected HTTP ${res.status}` }
  } catch (err) {
    // In a browser a CORS block and a dead network look the same.
    return { service, ok: false, detail: `unreachable (${err instanceof Error ? err.message : 'network error'})` }
  } finally {
    clearTimeout(timer)
  }
}

/** Opening the live-transcription socket is exactly what real use does, so it also proves the network path. */
function probeDeepgram(key: string): Promise<TestResult> {
  return new Promise((resolve) => {
    let ws: WebSocket
    let done = false
    const finish = (ok: boolean, detail: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      resolve({ service: 'deepgram', ok, detail })
    }
    const timer = setTimeout(() => finish(false, 'timed out connecting to Deepgram'), TIMEOUT_MS)
    try {
      ws = new WebSocket(deepgramUrl('en'), ['token', key])
    } catch {
      // The browser's message quotes the offending subprotocol, i.e. the key, so don't pass it on.
      finish(false, 'invalid key format')
      return
    }
    ws.onopen = () => finish(true, 'key valid · live transcription reachable')
    ws.onerror = () => finish(false, 'connection refused — key rejected or Deepgram unreachable')
    ws.onclose = () => finish(false, 'connection closed before opening — key rejected?')
  })
}

function providerProbe(provider: Provider, key: string): Promise<TestResult> {
  switch (provider) {
    case 'google':
      return probeHttp('google', 'https://translation.googleapis.com/language/translate/v2/languages', { 'X-Goog-Api-Key': key })
    case 'openrouter':
      return probeHttp('openrouter', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })
    case 'anthropic':
      return probeHttp('anthropic', 'https://api.anthropic.com/v1/models', {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      })
  }
}

export async function testConfig(cfg: ResolvedConfig): Promise<TestResult[]> {
  const tKey = translateKey(cfg.translate)
  const [stt, provider] = await Promise.all([
    cfg.deepgramKey ? probeDeepgram(cfg.deepgramKey) : Promise.resolve<TestResult>({ service: 'deepgram', ok: false, detail: 'no key set' }),
    tKey ? providerProbe(cfg.translate.provider, tKey) : Promise.resolve<TestResult>({ service: cfg.translate.provider, ok: false, detail: 'no key set' }),
  ])
  const results = [stt, provider]

  // Google returns no romaji, so make sure the local dictionary is usable before the first real phrase.
  if (provider.ok && cfg.translate.provider === 'google') {
    const t0 = Date.now()
    try {
      await loadRomajiDictionary()
      results.push({ service: 'romaji', ok: true, detail: `dictionary ready (${((Date.now() - t0) / 1000).toFixed(1)}s)` })
    } catch (err) {
      results.push({ service: 'romaji', ok: false, detail: `dictionary failed to load: ${err instanceof Error ? err.message : 'error'}` })
    }
  }

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
