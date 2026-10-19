import { describe, expect, it } from 'vitest'
import { MAX_LABEL_BYTES, MAX_LABEL_CHARS, MAX_MENU_ITEMS, type MenuState, itemForId, itemIdAt, menuItems, menuPick } from './menu'

const state = (over: Partial<MenuState> = {}, settings: Partial<MenuState['settings']> = {}): MenuState => ({
  hasLlm: true,
  settings: { mode: 'standard', replyStyle: 'polite', maxOptions: 3, voiceFilter: true, glassesKana: false, ...settings },
  ...over,
})
const bytes = (s: string) => new TextEncoder().encode(s).length

describe('menu items', () => {
  it('starts with Pause / Resume listening, then the settings with their current values', () => {
    expect(menuItems(state()).map((i) => i.label)).toEqual([
      'Pause / Resume',
      'Mode: Standard',
      'Replies: Polite',
      'Options: 3',
      'Voice filter: On',
      'Kana: Off',
    ])
    expect(menuItems(state({}, { mode: 'predictive', replyStyle: 'casual', maxOptions: 2, voiceFilter: false, glassesKana: true })).map((i) => i.label)).toEqual([
      'Pause / Resume',
      'Mode: Predictive',
      'Replies: Casual',
      'Options: 2',
      'Voice filter: Off',
      'Kana: On',
    ])
  })

  it('respects the firmware limits: at most 10 items, labels short enough not to be truncated, unique ids, and non-zero item ids', () => {
    for (const settings of [{}, { mode: 'predictive', replyStyle: 'casual', maxOptions: 2, voiceFilter: false, glassesKana: true }] as const) {
      const items = menuItems(state({}, settings))
      expect(items.length).toBeLessThanOrEqual(MAX_MENU_ITEMS)
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
      for (const i of items) {
        expect(bytes(i.label)).toBeLessThanOrEqual(MAX_LABEL_BYTES)
        expect(i.label.length).toBeLessThanOrEqual(MAX_LABEL_CHARS) // longer ones are cut off with "…" on the glasses
      }
      const ids = items.map((_, n) => itemIdAt(n))
      expect(ids.every((n) => Number.isInteger(n) && n > 0)).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('there is no Exit item: double tap is the exit', () => {
    expect(menuItems(state()).some((i) => /exit/i.test(i.label))).toBe(false)
  })
})

describe('menuPick', () => {
  it('toggles listening', () => {
    expect(menuPick(state(), 'toggle')).toEqual({ type: 'toggle_listen' })
    expect(menuPick(state(), 'nope')).toBeNull()
  })

  it('settings toggle their value', () => {
    expect(menuPick(state(), 'mode')).toEqual({ type: 'set', patch: { mode: 'predictive' } })
    expect(menuPick(state({}, { mode: 'predictive' }), 'mode')).toEqual({ type: 'set', patch: { mode: 'standard' } })
    expect(menuPick(state(), 'style')).toEqual({ type: 'set', patch: { replyStyle: 'casual' } })
    expect(menuPick(state(), 'options')).toEqual({ type: 'set', patch: { maxOptions: 2 } })
    expect(menuPick(state({}, { maxOptions: 2 }), 'options')).toEqual({ type: 'set', patch: { maxOptions: 3 } })
    expect(menuPick(state(), 'filter')).toEqual({ type: 'set', patch: { voiceFilter: false } })
    expect(menuPick(state(), 'kana')).toEqual({ type: 'set', patch: { glassesKana: true } })
  })

  it('predictive mode cannot be switched on without an LLM key, but can always be switched off', () => {
    expect(menuPick(state({ hasLlm: false }), 'mode')).toMatchObject({ type: 'note' })
    expect(menuPick(state({ hasLlm: false }, { mode: 'predictive' }), 'mode')).toEqual({ type: 'set', patch: { mode: 'standard' } })
  })
})

describe('itemForId', () => {
  it('maps the OS item id back to the item, and ignores anything it never declared', () => {
    const items = menuItems(state())
    expect(itemForId(items, itemIdAt(0))?.id).toBe('toggle')
    expect(itemForId(items, itemIdAt(5))?.id).toBe('kana')
    expect(itemForId(items, 0)).toBeNull()
    expect(itemForId(items, 99)).toBeNull()
    expect(itemForId(items, undefined)).toBeNull()
  })
})
