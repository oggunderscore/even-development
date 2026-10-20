import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList as T } from '@evenrealities/even_hub_sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type GlassesActions, SINGLE_TAP_MS, createGlassesEventHandler } from './glasses-events'

const ev = (e: Record<string, unknown>) => e as unknown as EvenHubEvent

function setup(shutdown: (mode: number) => Promise<boolean> = async () => true) {
  const bridge = { shutDownPageContainer: vi.fn(shutdown) }
  const actions = {
    bridge: () => bridge,
    toggleListening: vi.fn(),
    scroll: vi.fn(),
    menuPick: vi.fn(),
    resumeCapture: vi.fn(),
    haltCapture: vi.fn(),
    note: vi.fn(),
  } satisfies GlassesActions
  return { bridge, actions, handle: createGlassesEventHandler(actions) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('double tap → the system exit confirmation', () => {
  it('a double tap on the system event calls shutDownPageContainer(1), and never the immediate mode', async () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT, eventSource: 1 } }))
    await vi.advanceTimersByTimeAsync(1)
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledTimes(1)
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledWith(1)
    expect(t.bridge.shutDownPageContainer).not.toHaveBeenCalledWith(0)
  })

  it('the same on the capturing text container\'s event, and on both parts at once (still one dialog)', async () => {
    const a = setup()
    a.handle(ev({ textEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1)
    expect(a.bridge.shutDownPageContainer).toHaveBeenCalledWith(1)

    const b = setup()
    b.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT }, textEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    b.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } })) // a repeat for the same gesture
    await vi.advanceTimersByTimeAsync(1)
    expect(b.bridge.shutDownPageContainer).toHaveBeenCalledTimes(1)
  })

  it('a double tap is its own gesture: the first tap does not also pause/resume listening', async () => {
    const t = setup()
    t.handle(ev({ textEvent: {} })) // the first tap
    t.handle(ev({ textEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(SINGLE_TAP_MS * 2)
    expect(t.actions.toggleListening).not.toHaveBeenCalled()
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledWith(1)
  })

  it('nothing is torn down first, so answering "No" leaves listening alone', async () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(10)
    expect(t.actions.haltCapture).not.toHaveBeenCalled()
  })

  it('a refused request is retried once, and if it still fails the wearer is told instead of nothing happening', async () => {
    const t = setup(async () => false)
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledTimes(2)
    expect(t.actions.note).toHaveBeenCalledWith('Could not open the exit dialog. Double tap again.')
  })

  it('a refusal that succeeds on the retry says nothing', async () => {
    let calls = 0
    const t = setup(async () => ++calls > 1)
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledTimes(2)
    expect(t.actions.note).not.toHaveBeenCalled()
  })

  it('a throwing bridge is handled like a refusal, and with no bridge yet it just reports', async () => {
    const t = setup(async () => {
      throw new Error('boom')
    })
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.actions.note).toHaveBeenCalled()

    const noBridge = { ...setup().actions, bridge: () => null }
    createGlassesEventHandler(noBridge)(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(noBridge.note).toHaveBeenCalled()
  })

  it('a second double tap a moment later opens the dialog again (e.g. after answering No)', async () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(1500)
    t.handle(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))
    await vi.advanceTimersByTimeAsync(10)
    expect(t.bridge.shutDownPageContainer).toHaveBeenCalledTimes(2)
  })
})

describe('the other gestures', () => {
  it('a single tap pauses/resumes after a short wait; a second tap inside the wait is not a second toggle', async () => {
    const t = setup()
    t.handle(ev({ textEvent: {} }))
    expect(t.actions.toggleListening).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SINGLE_TAP_MS + 1)
    expect(t.actions.toggleListening).toHaveBeenCalledTimes(1)
  })

  it('swipes scroll, throttled', async () => {
    const t = setup()
    t.handle(ev({ textEvent: { eventType: T.SCROLL_TOP_EVENT } }))
    t.handle(ev({ textEvent: { eventType: T.SCROLL_TOP_EVENT } }))
    expect(t.actions.scroll).toHaveBeenCalledTimes(1)
    expect(t.actions.scroll).toHaveBeenCalledWith('up')
    await vi.advanceTimersByTimeAsync(400)
    t.handle(ev({ textEvent: { eventType: T.SCROLL_BOTTOM_EVENT } }))
    expect(t.actions.scroll).toHaveBeenLastCalledWith('down')
  })

  it('a pick from the OS menu goes to the menu handler with its item id', () => {
    const t = setup()
    t.handle(ev({ menuItemClickEvent: { itemID: 4 } }))
    expect(t.actions.menuPick).toHaveBeenCalledWith(4)
  })

  it('long press does nothing', async () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.LONG_PRESS_EVENT } }))
    t.handle(ev({ sysEvent: { eventType: T.LONG_PRESS_RELEASE_EVENT } }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.actions.toggleListening).not.toHaveBeenCalled()
    expect(t.bridge.shutDownPageContainer).not.toHaveBeenCalled()
  })

  it('lifecycle: the app closing halts capture; coming back re-arms it, and the first tap back does not also pause it', async () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.SYSTEM_EXIT_EVENT } }))
    expect(t.actions.haltCapture).toHaveBeenCalledTimes(1)
    t.handle(ev({ textEvent: {} })) // the user answered No and taps
    expect(t.actions.resumeCapture).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SINGLE_TAP_MS * 2)
    expect(t.actions.toggleListening).not.toHaveBeenCalled()
    t.handle(ev({ textEvent: {} })) // the next tap is an ordinary one
    await vi.advanceTimersByTimeAsync(SINGLE_TAP_MS + 1)
    expect(t.actions.toggleListening).toHaveBeenCalledTimes(1)
  })

  it('foreground and abnormal exit re-arm capture', () => {
    const t = setup()
    t.handle(ev({ sysEvent: { eventType: T.FOREGROUND_ENTER_EVENT } }))
    t.handle(ev({ sysEvent: { eventType: T.ABNORMAL_EXIT_EVENT } }))
    expect(t.actions.resumeCapture).toHaveBeenCalledTimes(2)
  })
})
