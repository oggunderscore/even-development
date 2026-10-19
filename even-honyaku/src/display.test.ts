import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Display, formatEntry } from './display'
import type { Prediction, Translation } from './protocol'

/** A bridge that records what the glasses were told. */
function fakeBridge(opts: { rebuildOk?: boolean } = {}) {
  const calls: { kind: 'create' | 'rebuild' | 'upgrade'; data: any }[] = []
  const bridge = {
    createStartUpPageContainer: vi.fn(async (p: any) => (calls.push({ kind: 'create', data: p }), 0)),
    rebuildPageContainer: vi.fn(async (p: any) => (calls.push({ kind: 'rebuild', data: p }), opts.rebuildOk ?? true)),
    textContainerUpgrade: vi.fn(async (u: any) => (calls.push({ kind: 'upgrade', data: u }), true)),
  }
  const upgrades = (id: number) => calls.filter((c) => c.kind === 'upgrade' && c.data.containerID === id).map((c) => c.data.content as string)
  /** The newest content a container was given, whether by a page (re)build or by an in-place update. */
  const lastText = (id: number) => {
    let text: string | undefined
    for (const c of calls) {
      if (c.kind === 'upgrade' && c.data.containerID === id) text = c.data.content
      else if (c.kind !== 'upgrade') text = (c.data.textObject as any[]).find((t) => t.containerID === id)?.content ?? text
    }
    return text
  }
  return { bridge: bridge as never, calls, upgrades, lastText, spies: bridge }
}

const hear = (id: number, english: string, extra: Partial<Translation> = {}): Translation => ({ id, dir: 'listen', japanese: 'ホットですか', romaji: 'hotto desu ka', english, ...extra })
const choice: Prediction = {
  kind: 'choice',
  options: [
    { gloss: 'Hot, please', ja: 'ホット', romaji: 'hotto onegai' },
    { gloss: 'Iced, please', ja: 'アイス', romaji: 'aisu onegai' },
  ],
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Display: layouts', () => {
  it('standard mode starts with header, body and footer, and the footer points at the menu', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    const page = f.calls[0]!.data
    expect(page.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body', 'footer'])
    expect(page.textObject[1].isEventCapture).toBe(1)
    expect(page.textObject[2].content).toContain('2x tap: menu')
    expect(page.textObject[2].content).not.toContain('hold')
  })

  it('predictive mode gives the body the footer\'s space and drops the footer', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { mode: 'predictive' })
    await d.init()
    const page = f.calls[0]!.data
    expect(page.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body'])
    expect(page.textObject[1].height).toBe(256)
  })

  it('switching mode rebuilds the page; switching to the same mode does nothing', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    await d.setMode('predictive')
    await d.setMode('predictive')
    expect(f.calls.filter((c) => c.kind === 'rebuild')).toHaveLength(1)
    expect(f.calls.at(-1)!.data.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body'])
  })
})

describe('Display: menu overlay', () => {
  const items = [
    { id: 'toggle', label: 'Pause listening' },
    { id: 'settings', label: 'Settings' },
    { id: 'exit', label: 'Exit' },
  ]

  it('opens as a native list that captures input, with the old body no longer capturing', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    expect(await d.openMenu(items)).toBe(true)
    const page = f.calls.at(-1)!.data
    expect(d.menuOpen).toBe(true)
    expect(page.listObject[0].itemContainer.itemName).toEqual(['Pause listening', 'Settings', 'Exit'])
    expect(page.listObject[0].isEventCapture).toBe(1)
    expect(page.textObject.every((t: any) => t.isEventCapture === 0)).toBe(true)
    expect(page.textObject[0].content).toMatch(/MENU/)
    // exactly one container captures input (a platform rule)
    const capturing = [...page.textObject, ...page.listObject].filter((c: any) => c.isEventCapture === 1)
    expect(capturing).toHaveLength(1)
  })

  it('redrawing with new items rebuilds again; closing returns to the mode\'s own layout', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { mode: 'predictive' })
    await d.init()
    await d.openMenu(items)
    await d.openMenu([{ id: 'toggle', label: 'Resume listening' }])
    expect(f.calls.at(-1)!.data.listObject[0].itemContainer.itemName).toEqual(['Resume listening'])
    await d.closeMenu()
    expect(d.menuOpen).toBe(false)
    expect(f.calls.at(-1)!.data.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body'])
  })

  it('a mode change made inside the menu takes effect when it closes', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    await d.openMenu(items)
    await d.setMode('predictive')
    expect(d.menuOpen).toBe(true)
    await d.closeMenu()
    expect(f.calls.at(-1)!.data.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body'])
  })

  it('if the glasses refuse the rebuild, the old layout stays and the menu is not considered open', async () => {
    const f = fakeBridge({ rebuildOk: false })
    const d = new Display(f.bridge)
    await d.init()
    expect(await d.openMenu(items)).toBe(false)
    expect(d.menuOpen).toBe(false)
  })

  it('swipes and taps do nothing to the conversation while the menu is open', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { mode: 'predictive' })
    await d.init()
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    d.predictions(1, choice)
    await d.openMenu(items)
    expect(d.tap()).toBeUndefined()
    d.scroll('down')
    await d.closeMenu()
    await flush()
    expect(f.lastText(2)).toMatch(/▶ 1 Hot, please/)
  })
})

describe('Display: predictive screen', () => {
  let f: ReturnType<typeof fakeBridge>
  let d: Display
  beforeEach(async () => {
    f = fakeBridge()
    d = new Display(f.bridge, { mode: 'predictive' })
    await d.init()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the question, then the replies, and marks the one the wearer read aloud', async () => {
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    await flush()
    expect(f.lastText(2)).toBe('JP: Hot or iced?\n\nthinking...')
    d.predictions(1, choice)
    await flush()
    expect(f.lastText(2)).toContain('▶ 1 Hot, please\n     hotto onegai\n  2 Iced, please')
    expect(f.lastText(1)).toContain('swipe: pick')
    d.self(1)
    await flush()
    expect(f.lastText(2)).toContain('● 2 Iced, please')
  })

  it('the wearer speaking Japanese that matches nothing still ends the wait for suggestions', async () => {
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    d.self(0, 42) // an answer to some other turn's options
    await flush()
    expect(f.lastText(2)).not.toMatch(/thinking/)
  })

  it('swipe moves the highlight, tap zooms and reports the option once', async () => {
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    d.predictions(1, choice)
    d.scroll('down')
    await flush()
    expect(f.lastText(2)).toContain('▶ 2 Iced, please')
    expect(d.tap()).toEqual(choice.options[1])
    expect(d.tap()).toBeUndefined() // zooming back out is not a second choice
  })

  it('the other person\'s interim words appear as a new turn, the wearer\'s own interim English does not', async () => {
    d.setLive('hello there', 'speak')
    await flush()
    expect(f.lastText(2)).toMatch(/Waiting/)
    d.setLive('ホットで', 'listen') // interim text is throttled to protect the BLE link; the latest still lands
    await new Promise((r) => setTimeout(r, 450))
    expect(f.lastText(2)).toContain('JP: ホットで...')
  })

  it('errors flash in the header instead of polluting the conversation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    d.note('translate: 429')
    await vi.advanceTimersByTimeAsync(10)
    expect(f.lastText(1)).toContain('translate: 429')
    expect(f.lastText(2)).toMatch(/Waiting/)
    await vi.advanceTimersByTimeAsync(5100)
    expect(f.lastText(1)).not.toContain('translate')
  })

  it('paused with nothing to show says how to resume', async () => {
    d.setState('idle')
    await flush()
    expect(f.lastText(2)).toBe('Paused - not listening.\nDouble tap > Resume listening.')
  })

  it('does not resend identical text', async () => {
    d.setState('listening')
    d.setState('listening')
    d.setState('listening')
    await flush()
    expect(f.upgrades(1).filter((t) => t.includes('listening'))).toHaveLength(1)
  })
})

describe('formatEntry', () => {
  it('classic entries; kana is added only when asked for', () => {
    const t = hear(1, 'How much?', { japanese: 'いくらですか', romaji: 'ikura desu ka' })
    expect(formatEntry(t)).toBe('JP: ikura desu ka\n> How much?')
    expect(formatEntry(t, true)).toBe('JP: ikura desu ka\nいくらですか\n> How much?')
    expect(formatEntry({ ...t, unsure: true })).toMatch(/^JP\?:/)
    expect(formatEntry({ ...t, heardEnglish: true, english: 'Okay' })).toBe('them: Okay')
    expect(formatEntry({ id: 2, dir: 'speak', english: 'Thanks', japanese: 'ありがとう', romaji: 'arigatou' })).toBe('you: Thanks\n> arigatou')
  })
})
