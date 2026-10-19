// Checks that API keys (and the chosen model) actually work. Runs automatically a moment after a key is entered or the
// provider / model changes, and the Settings tab shows the answer under the field. Output never contains a key.

import type { Provider, TestResult, TestScope } from '../protocol'
import { type ResolvedConfig, translateKey } from './config'
import { deepgramUrl } from './stt'
import { activeModel } from './models'
import { translate } from './translate'
import { loadRomajiDictionary } from './romaji'

const TIMEOUT_MS = 8000

export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', openrouter: 'OpenRouter', anthropic: 'Claude (Anthropic)' }

async function probeHttp(service: Provider, url: string, headers: Record<string, string>): Promise<TestResult> {
  const name = PROVIDER_NAME[service]
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: ctl.signal })
    if (res.ok) return { service, ok: true, detail: 'key accepted' }
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return { service, ok: false, detail: `${name} rejected this key (HTTP ${res.status}). Check that you copied all of it, with no spaces.` }
    }
    return { service, ok: false, detail: `${name} answered with an error (HTTP ${res.status}). Try again in a moment.` }
  } catch {
    // In a browser a CORS block and a dead network look the same.
    return { service, ok: false, detail: `Could not reach ${name}. Check your internet connection.` }
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
    const timer = setTimeout(() => finish(false, 'Could not reach Deepgram (timed out). Check your internet connection.'), TIMEOUT_MS)
    try {
      ws = new WebSocket(deepgramUrl('en'), ['token', key])
    } catch {
      // The browser's message quotes the offending subprotocol, i.e. the key, so don't pass it on.
      finish(false, 'That does not look like a Deepgram key.')
      return
    }
    ws.onopen = () => finish(true, 'key accepted · live transcription reachable')
    ws.onerror = () => finish(false, 'Deepgram rejected this key, or could not be reached. Check the key and your internet connection.')
    ws.onclose = () => finish(false, 'Deepgram closed the connection: the key was probably rejected.')
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

/** Check the Deepgram key (`stt`) or the translation provider's key and chosen model (`translate`). */
export async function testConfig(cfg: ResolvedConfig, scope: TestScope = 'translate'): Promise<TestResult[]> {
  if (scope === 'stt') {
    return [cfg.deepgramKey ? await probeDeepgram(cfg.deepgramKey) : { service: 'deepgram', ok: false, detail: 'No key entered.' }]
  }

  const tKey = translateKey(cfg.translate)
  const provider: TestResult = tKey
    ? await providerProbe(cfg.translate.provider, tKey)
    : { service: cfg.translate.provider, ok: false, detail: 'No key entered.' }
  const results = [provider]

  // Google returns no romaji, so make sure the local dictionary is usable before the first real phrase.
  if (provider.ok && cfg.translate.provider === 'google') {
    const t0 = Date.now()
    try {
      await loadRomajiDictionary()
      results.push({ service: 'romaji', ok: true, detail: `dictionary ready (${((Date.now() - t0) / 1000).toFixed(1)}s)` })
    } catch (err) {
      results.push({ service: 'romaji', ok: false, detail: `The romaji dictionary failed to load: ${err instanceof Error ? err.message : 'error'}` })
    }
  }

  // End to end with the chosen model: only worth a call if the provider accepted the key.
  if (provider.ok) {
    const model = activeModel(cfg.translate.provider, cfg.translate)
    try {
      const t = await translate('speak', 'How much is this?', [], 0, cfg.translate)
      results.push({ service: 'translate', ok: true, detail: `"How much is this?" → ${t.romaji}` })
    } catch (err) {
      const why = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 120) : 'failed'
      results.push({
        service: 'translate',
        ok: false,
        detail: model ? `The key works, but the model "${model}" did not answer (${why}). Choose another model.` : `The key works, but a test translation failed (${why}).`,
      })
    }
  }
  return results
}

/** One line for the field: ok only if every check passed; otherwise the first thing that failed. */
export function summarize(results: TestResult[]): { ok: boolean; text: string } {
  const failed = results.find((r) => !r.ok)
  if (failed) return { ok: false, text: failed.detail }
  const sample = results.find((r) => r.service === 'translate')
  return { ok: true, text: sample ? 'Key accepted · test translation worked' : (results[0]?.detail ?? 'ok') }
}
