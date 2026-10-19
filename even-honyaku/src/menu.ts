// The glasses menu (double tap): Pause / Resume listening, Settings, Exit. Pure state → items → action, so it is
// testable without a bridge. The Display draws the items as a native list; a list can't be updated in place, so every
// change (a toggled setting, a renamed Pause/Resume) re-draws the whole menu, and the highlight starts at the top again.

import type { Settings } from './settings'

export type MenuScreen = 'main' | 'settings'

export interface MenuState {
  screen: MenuScreen
  listening: boolean
  settings: Pick<Settings, 'mode' | 'replyStyle' | 'maxOptions' | 'voiceFilter' | 'glassesKana'>
  /** Predictive mode needs an OpenRouter or Claude key. */
  hasLlm: boolean
}

export interface MenuItem {
  id: string
  /** At most 64 characters (a platform limit on list items). */
  label: string
}

export type MenuAction =
  | { type: 'toggle_listen' }
  | { type: 'screen'; screen: MenuScreen }
  | { type: 'exit' }
  | { type: 'set'; patch: Partial<Settings> }
  | { type: 'note'; text: string }

const onOff = (b: boolean) => (b ? 'On' : 'Off')

export function menuItems(s: MenuState): MenuItem[] {
  if (s.screen === 'main') {
    return [
      { id: 'toggle', label: s.listening ? 'Pause listening' : 'Resume listening' },
      { id: 'settings', label: 'Settings' },
      { id: 'exit', label: 'Exit' },
    ]
  }
  const c = s.settings
  return [
    { id: 'mode', label: `Mode: ${c.mode === 'predictive' ? 'Predictive replies' : 'Standard'}` },
    { id: 'style', label: `Replies: ${c.replyStyle === 'polite' ? 'Polite' : 'Casual'}` },
    { id: 'options', label: `Options shown: ${c.maxOptions}` },
    { id: 'filter', label: `Ignore my own voice: ${onOff(c.voiceFilter)}` },
    { id: 'kana', label: `Kana on glasses: ${onOff(c.glassesKana)}` },
    { id: 'back', label: 'Back' },
  ]
}

/** What picking an item does. Unknown ids do nothing. */
export function menuPick(s: MenuState, id: string): MenuAction | null {
  const c = s.settings
  switch (id) {
    case 'toggle':
      return { type: 'toggle_listen' }
    case 'settings':
      return { type: 'screen', screen: 'settings' }
    case 'exit':
      return { type: 'exit' }
    case 'back':
      return { type: 'screen', screen: 'main' }
    case 'mode':
      if (c.mode === 'standard' && !s.hasLlm) return { type: 'note', text: 'Predictive needs an OpenRouter or Claude key' }
      return { type: 'set', patch: { mode: c.mode === 'predictive' ? 'standard' : 'predictive' } }
    case 'style':
      return { type: 'set', patch: { replyStyle: c.replyStyle === 'polite' ? 'casual' : 'polite' } }
    case 'options':
      return { type: 'set', patch: { maxOptions: c.maxOptions === 3 ? 2 : 3 } }
    case 'filter':
      return { type: 'set', patch: { voiceFilter: !c.voiceFilter } }
    case 'kana':
      return { type: 'set', patch: { glassesKana: !c.glassesKana } }
    default:
      return null
  }
}

/**
 * A list click names the picked item and/or gives its index. Index 0 is omitted by the protocol, so a missing index
 * means the first item; the name is preferred when present because it cannot be off by one.
 */
export function resolvePick(items: MenuItem[], click: { name?: string; index?: number }): MenuItem | null {
  if (click.name) {
    const byName = items.find((i) => i.label === click.name)
    if (byName) return byName
  }
  return items[click.index ?? 0] ?? null
}
