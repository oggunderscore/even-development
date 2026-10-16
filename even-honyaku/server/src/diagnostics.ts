// Startup self-check: report config and verify the API keys actually work, so a bad key is
// visible in the server log immediately instead of as a silent failure mid-conversation.

import { log, warn } from './log'
import { loadRomajiDictionary } from './romaji'
import { listenEngine } from './stt'
import { translateProvider } from './translate'

async function probe(name: string, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
    if (res.ok) log('check', `${name}: key OK`)
    else if (res.status === 401 || res.status === 403) warn('check', `${name}: key REJECTED (HTTP ${res.status}) — check server/.env`)
    else warn('check', `${name}: unexpected HTTP ${res.status}`)
  } catch (err) {
    warn('check', `${name}: could not reach API (${err instanceof Error ? err.message : err})`)
  }
}

export async function runStartupChecks(token: string) {
  const env = process.env
  const provider = translateProvider()
  log('config', `translate provider: ${provider}`)
  log('config', `listen engine: ${listenEngine()} (LISTEN_ENGINE = dual | ja | multi)`)
  log('config', `HONYAKU_TOKEN: ${token ? `set (${token.length} chars)` : 'EMPTY (auth disabled)'}`)
  if (token === 'change-me') warn('config', 'HONYAKU_TOKEN is still the placeholder "change-me" — fine for LAN dev, change before exposing')

  const checks: Promise<void>[] = []
  if (!env['DEEPGRAM_API_KEY']) warn('config', 'DEEPGRAM_API_KEY is not set — speech-to-text will fail')
  else checks.push(probe('Deepgram', 'https://api.deepgram.com/v1/projects', { Authorization: `Token ${env['DEEPGRAM_API_KEY']}` }))

  if (provider === 'google') {
    if (!env['GOOGLE_TRANSLATE_API_KEY']) warn('config', 'GOOGLE_TRANSLATE_API_KEY is not set — translation will fail')
    else {
      checks.push(probe('Google Translate', `https://translation.googleapis.com/language/translate/v2/languages?key=${encodeURIComponent(env['GOOGLE_TRANSLATE_API_KEY'])}`, {}))
      const t0 = Date.now()
      checks.push(loadRomajiDictionary().then(() => log('check', `romaji dictionary loaded in ${Date.now() - t0}ms`), (e) => warn('check', `romaji dictionary failed to load: ${e}`)))
    }
  } else if (provider === 'anthropic') {
    if (!env['ANTHROPIC_API_KEY']) warn('config', 'ANTHROPIC_API_KEY is not set — translation will fail')
  } else if (!env['OPENROUTER_API_KEY']) {
    warn('config', 'OPENROUTER_API_KEY is not set — translation will fail')
  } else {
    log('config', `OpenRouter model: ${env['OPENROUTER_MODEL'] || 'google/gemini-2.5-flash-lite (default)'}`)
    checks.push(probe('OpenRouter', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${env['OPENROUTER_API_KEY']}` }))
  }
  await Promise.all(checks)
}
