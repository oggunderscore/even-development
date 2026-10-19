import { describe, expect, it } from 'vitest'
import { type MenuState, menuItems, menuPick, resolvePick } from './menu'

const state = (over: Partial<MenuState> = {}, settings: Partial<MenuState['settings']> = {}): MenuState => ({
  screen: 'main',
  listening: true,
  hasLlm: true,
  settings: { mode: 'standard', replyStyle: 'polite', maxOptions: 3, voiceFilter: true, glassesKana: false, ...settings },
  ...over,
})

describe('menu', () => {
  it('main menu is Pause/Resume, Settings, Exit — and the first item says what it will do', () => {
    expect(menuItems(state()).map((i) => i.label)).toEqual(['Pause listening', 'Settings', 'Exit'])
    expect(menuItems(state({ listening: false }))[0]!.label).toBe('Resume listening')
  })

  it('every label fits the platform limit of 64 characters, and ids are unique', () => {
    for (const screen of ['main', 'settings'] as const) {
      const items = menuItems(state({ screen }, { mode: 'predictive', glassesKana: true }))
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
      for (const i of items) expect(i.label.length).toBeLessThanOrEqual(64)
    }
  })

  it('settings screen shows the current values', () => {
    const labels = menuItems(state({ screen: 'settings' }, { mode: 'predictive', replyStyle: 'casual', maxOptions: 2, voiceFilter: false, glassesKana: true })).map((i) => i.label)
    expect(labels).toEqual(['Mode: Predictive replies', 'Replies: Casual', 'Options shown: 2', 'Ignore my own voice: Off', 'Kana on glasses: On', 'Back'])
  })

  it('picking maps to actions: navigation, listening, exit', () => {
    expect(menuPick(state(), 'toggle')).toEqual({ type: 'toggle_listen' })
    expect(menuPick(state(), 'settings')).toEqual({ type: 'screen', screen: 'settings' })
    expect(menuPick(state({ screen: 'settings' }), 'back')).toEqual({ type: 'screen', screen: 'main' })
    expect(menuPick(state(), 'exit')).toEqual({ type: 'exit' })
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

describe('resolvePick', () => {
  const items = menuItems(state())
  it('prefers the name, falls back to the index, and treats a missing index as the first item', () => {
    expect(resolvePick(items, { name: 'Exit', index: 0 })?.id).toBe('exit')
    expect(resolvePick(items, { index: 1 })?.id).toBe('settings')
    expect(resolvePick(items, {})?.id).toBe('toggle')
    expect(resolvePick(items, { index: 9 })).toBeNull()
    expect(resolvePick(items, { name: 'renamed since', index: 2 })?.id).toBe('exit')
  })
})
