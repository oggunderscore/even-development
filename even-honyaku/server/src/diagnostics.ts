// Startup self-check. User keys arrive per connection (see config.ts); the server's own .env keys are only
// used, and therefore only checked, when ALLOW_SERVER_KEYS is on.

import { resolveConfig } from '../../src/core/config'
import { testConfig } from '../../src/core/probes'
import { loadRomajiDictionary } from '../../src/core/romaji'
import { serverFallback } from './env'
import { log, warn } from './log'

export async function runStartupChecks(token: string) {
  log('config', `HONYAKU_TOKEN: ${token ? `set (${token.length} chars)` : 'EMPTY (auth disabled)'}`)
  if (token === 'change-me') warn('config', 'HONYAKU_TOKEN is still the placeholder "change-me" — fine for private dev, change before exposing')

  const t0 = Date.now()
  void loadRomajiDictionary().then(
    () => log('check', `romaji dictionary loaded in ${Date.now() - t0}ms`),
    (e) => warn('check', `romaji dictionary failed to load: ${e}`),
  )

  const fallback = serverFallback()
  if (!fallback) return
  const results = await testConfig(resolveConfig({}, fallback))
  for (const r of results) (r.ok ? log : warn)('check', `${r.service}: ${r.detail}`)
}
