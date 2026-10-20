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
    expect(page.textObject[2].content).toBe('tap: pause/resume   2x tap: exit')
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

describe('Display: OS contextual menu', () => {
  const items = [
    { id: 'toggle', label: 'Pause / Resume' },
    { id: 'mode', label: 'Mode: Standard' },
  ]
  const declared = (page: any) => page.menuObject?.menuItems?.map((m: any) => [m.itemID, m.itemName])

  it('is declared on the first page, with non-zero unique ids', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    expect(declared(f.calls[0]!.data)).toEqual([[1, 'Pause / Resume'], [2, 'Mode: Standard']])
  })

  it('no in-app overlay: the page is still just the screen, with the body capturing input', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    const page = f.calls[0]!.data
    expect(page.listObject).toBeUndefined()
    expect(page.textObject.filter((t: any) => t.isEventCapture === 1)).toHaveLength(1)
    expect(page.textObject.every((t: any) => t.zOrderIndex === undefined)).toBe(true)
  })

  it('every rebuild re-declares the menu (leaving it out would clear it)', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    await d.setMode('predictive')
    expect(declared(f.calls.at(-1)!.data)).toEqual([[1, 'Pause / Resume'], [2, 'Mode: Standard']])
  })

  it('changed labels rebuild the page with the new labels; identical labels do nothing', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    await d.setMenu(items)
    expect(f.calls.filter((c) => c.kind === 'rebuild')).toHaveLength(0)
    await d.setMenu([items[0]!, { id: 'mode', label: 'Mode: Predictive' }])
    expect(f.calls.filter((c) => c.kind === 'rebuild')).toHaveLength(1)
    expect(declared(f.calls.at(-1)!.data)).toEqual([[1, 'Pause / Resume'], [2, 'Mode: Predictive']])
  })

  it('a mode change and new labels together cost one rebuild', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    await d.configure({ mode: 'predictive', menu: [items[0]!, { id: 'mode', label: 'Mode: Predictive' }] })
    expect(f.calls.filter((c) => c.kind === 'rebuild')).toHaveLength(1)
    const page = f.calls.at(-1)!.data
    expect(page.textObject.map((t: any) => t.containerName)).toEqual(['header', 'body'])
    expect(declared(page)[1][1]).toBe('Mode: Predictive')
  })

  it('a menu with no items is simply not declared', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    expect(f.calls[0]!.data.menuObject).toBeUndefined()
  })

  it('if the glasses refuse the rebuild, mode and menu roll back to what is actually on screen', async () => {
    const f = fakeBridge({ rebuildOk: false })
    const d = new Display(f.bridge, { menu: items })
    await d.init()
    await d.configure({ mode: 'predictive', menu: [items[0]!] })
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    await flush()
    expect(f.lastText(2)).toContain('hotto desu ka') // standard entries show the romaji line, predictive ones do not
    await d.setMenu(items) // unchanged from the rolled-back state: no further rebuild attempt
    expect(f.calls.filter((c) => c.kind === 'rebuild')).toHaveLength(1)
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
    expect(f.lastText(1)).toContain('swipe: highlight')
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

  it('swipe moves the highlight', async () => {
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    d.predictions(1, choice)
    d.scroll('down')
    await flush()
    expect(f.lastText(2)).toContain('▶ 2 Iced, please')
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

  it('"thinking..." never stays up: with no word from the engine the screen gives up after 9 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    await vi.advanceTimersByTimeAsync(100)
    expect(f.lastText(2)).toMatch(/thinking/)
    await vi.advanceTimersByTimeAsync(8500)
    expect(f.lastText(2)).toMatch(/thinking/) // still within the two 3 s attempts and the margin
    await vi.advanceTimersByTimeAsync(600)
    expect(f.lastText(2)).not.toMatch(/thinking/)
    expect(f.lastText(2)).toContain('Replies: too slow (R-TIME)')
  })

  it('suggestions, a failure, a skipped turn or the wearer answering all stop the wait at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    d.addTranslation(hear(1, 'Hot or iced?'), true)
    d.predictions(1, choice)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(f.lastText(2)).toContain('Hot, please') // the watchdog did not fire over real suggestions
    expect(f.lastText(2)).not.toContain('R-TIME')

    d.addTranslation(hear(2, 'Yes.'), true)
    d.predictionSkipped(2) // a bare acknowledgement: nothing to suggest
    await vi.advanceTimersByTimeAsync(100)
    expect(f.lastText(2)).not.toMatch(/thinking/)

    d.addTranslation(hear(3, 'Anything else?'), true)
    d.predictionFailed('Replies: busy or out of credit (R-RATE)')
    await vi.advanceTimersByTimeAsync(100)
    expect(f.lastText(2)).not.toMatch(/thinking/)
    expect(f.lastText(2)).toContain('R-RATE')
  })

  it('paused with nothing to show says how to resume', async () => {
    d.setState('idle')
    await flush()
    expect(f.lastText(2)).toBe('Paused - not listening.\nTap to resume.')
  })

  it('does not resend identical text', async () => {
    d.setState('listening')
    d.setState('listening')
    d.setState('listening')
    await flush()
    expect(f.upgrades(1).filter((t) => t.includes('listening'))).toHaveLength(1)
  })
})

describe('Display: header', () => {
  it('shows the app name (as in the store listing), on the setup screen too', async () => {
    const f = fakeBridge()
    const d = new Display(f.bridge)
    await d.init()
    d.setState('listening')
    await flush()
    expect(f.lastText(1)).toBe('Honyaku   ● listening')
    d.setSetup(['Deepgram key'])
    await flush()
    expect(f.lastText(1)).toBe('Honyaku   x setup needed')
  })

  it('a flashed message replaces the header for a few seconds on both screens, then the header returns', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      for (const mode of ['standard', 'predictive'] as const) {
        const f = fakeBridge()
        const d = new Display(f.bridge, { mode })
        await d.init()
        d.setState('listening')
        d.flashMessage('Replies: Casual')
        await vi.advanceTimersByTimeAsync(10)
        expect(f.lastText(1)).toBe('● listening   Replies: Casual')
        await vi.advanceTimersByTimeAsync(5200)
        expect(f.lastText(1)).toMatch(/listening/)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('formatEntry', () => {
  it('classic entries; kana is added only when asked for', () => {
    const t = hear(1, 'How much?', { japanese: 'いくらですか', romaji: 'ikura desu ka' })
    expect(formatEntry(t)).toBe('JP: ikura desu ka\n> How much?')
    expect(formatEntry(t, true)).toBe('JP: ikura desu ka\nいくらですか\n> How much?')
    expect(formatEntry({ ...t, unsure: true })).toMatch(/^JP\?:/)
    expect(formatEntry({ ...t, heardEnglish: true, english: 'Okay' })).toBe('them: Okay')
    expect(formatEntry({ ...t, romaji: '' })).toBe('JP> How much?') // romaji not available yet: just the English
    expect(formatEntry({ id: 2, dir: 'speak', english: 'Thanks', japanese: 'ありがとう', romaji: 'arigatou' })).toBe('you: Thanks\n> arigatou')
  })
})
