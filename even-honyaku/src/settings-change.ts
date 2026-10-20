// What a settings change (made in the form, which now saves itself) requires: whether to restart the speech stream,
// which key checks to run, and which stale results to clear. Pure, so the rules are tested rather than hoped for.

import { activeModel } from './core/models'
import type { Provider, TestScope } from './protocol'
import { type Settings, normalizeSettings, providerKey } from './settings'

export interface ChangePlan {
  /** Nothing relevant changed: don't save, restart or test anything. */
  changed: boolean
  /** The settings to keep (the provider may have been switched for the user). */
  next: Settings
  /** The provider was switched because only another provider had a key. */
  switchedProvider: boolean
  /** The Deepgram key changed, so the open stream (which holds the old key) has to be reopened. */
  restartStream: boolean
  /** Run these key checks. */
  test: TestScope[]
  /** These fields no longer have a key to check: clear what was shown. */
  clear: TestScope[]
}

const modelOf = (s: Settings): string | undefined => activeModel(s.provider, s)
const keyOf = (s: Settings, p: Provider): string => (p === 'google' ? s.googleKey : p === 'openrouter' ? s.openrouterKey : s.anthropicKey)

export function planChange(prev: Settings, raw: Settings): ChangePlan {
  if (JSON.stringify(prev) === JSON.stringify(raw)) return { changed: false, next: prev, switchedProvider: false, restartStream: false, test: [], clear: [] }

  // Someone who pastes just an OpenRouter key shouldn't have to flip the provider as well, so when the chosen provider
  // has no key, switch to the provider whose key was just entered. Nothing else switches it: picking a provider that has
  // no key yet, or editing the Deepgram key, must not undo the user's choice.
  const normalized = normalizeSettings(raw)
  const enteredKeyFor = (p: Provider) => keyOf(prev, p) !== keyOf(raw, p) && keyOf(raw, p) !== ''
  const next = normalized.provider !== raw.provider && enteredKeyFor(normalized.provider) ? normalized : raw

  const test: TestScope[] = []
  const clear: TestScope[] = []

  if (prev.deepgramKey !== next.deepgramKey) (next.deepgramKey ? test : clear).push('stt')

  const translateChanged = prev.provider !== next.provider || providerKey(prev) !== providerKey(next) || modelOf(prev) !== modelOf(next)
  if (translateChanged) (providerKey(next) ? test : clear).push('translate')

  return {
    changed: true,
    next,
    switchedProvider: next.provider !== raw.provider,
    restartStream: prev.deepgramKey !== next.deepgramKey,
    test,
    clear,
  }
}
