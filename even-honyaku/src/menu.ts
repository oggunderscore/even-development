// The glasses menu: the OS contextual menu (tap then long press) with our own items — Pause / Resume listening and the
// settings. Double tap is not used here: on the home page it must open the system exit dialog (see exit.ts).
//
// The OS draws the menu and reports a pick as `menuItemClickEvent` carrying the `itemID` we declared. Every item is
// fire-and-forget (the menu closes, the label can't change in place), so a label that shows state is updated by
// re-declaring the menu on the next page rebuild. Pure state → items → action, testable without a bridge.

import type { Settings } from './settings'

export interface MenuState {
  settings: Pick<Settings, 'mode' | 'replyStyle' | 'maxOptions' | 'voiceFilter' | 'glassesKana'>
  /** Predictive mode needs an OpenRouter or Claude key. */
  hasLlm: boolean
}

export interface MenuItem {
  id: string
  /** At most 32 UTF-8 bytes (a firmware limit), but the OS menu also cuts anything past ~19 characters with "…". */
  label: string
}

export type MenuAction = { type: 'toggle_listen' } | { type: 'set'; patch: Partial<Settings> } | { type: 'note'; text: string }

/** The firmware accepts at most this many app items. */
export const MAX_MENU_ITEMS = 10
export const MAX_LABEL_BYTES = 32
/** Longer labels are truncated with an ellipsis by the glasses (seen in the simulator at about 19 characters). */
export const MAX_LABEL_CHARS = 18

const onOff = (b: boolean) => (b ? 'On' : 'Off')

export function menuItems(s: MenuState): MenuItem[] {
  const c = s.settings
  return [
    { id: 'toggle', label: 'Pause / Resume' },
    { id: 'mode', label: `Mode: ${c.mode === 'predictive' ? 'Predictive' : 'Standard'}` },
    { id: 'style', label: `Replies: ${c.replyStyle === 'polite' ? 'Polite' : 'Casual'}` },
    { id: 'options', label: `Options: ${c.maxOptions}` },
    { id: 'filter', label: `Voice filter: ${onOff(c.voiceFilter)}` },
    { id: 'kana', label: `Kana: ${onOff(c.glassesKana)}` },
  ]
}

/** The `itemID` declared to the OS for the item at this position (non-zero, unique). */
export const itemIdAt = (index: number): number => index + 1

/** Which item an OS pick refers to: the id is the item's position + 1. */
export function itemForId(items: MenuItem[], itemID: number | undefined): MenuItem | null {
  return items[(itemID ?? 0) - 1] ?? null
}

/** What picking an item does. Unknown ids do nothing. */
export function menuPick(s: MenuState, id: string): MenuAction | null {
  const c = s.settings
  switch (id) {
    case 'toggle':
      return { type: 'toggle_listen' }
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
