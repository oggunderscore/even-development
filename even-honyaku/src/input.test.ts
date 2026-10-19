import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList as T } from '@evenrealities/even_hub_sdk'
import { describe, expect, it } from 'vitest'
import { classifyInput, listClick } from './input'

const ev = (e: Record<string, unknown>) => e as unknown as EvenHubEvent

describe('classifyInput', () => {
  it('long press and release arrive on sysEvent', () => {
    expect(classifyInput(ev({ sysEvent: { eventType: T.LONG_PRESS_EVENT } }))).toBe('long_press')
    expect(classifyInput(ev({ sysEvent: { eventType: T.LONG_PRESS_RELEASE_EVENT } }))).toBe('long_press_release')
  })
  it('a tap on the capturing text container has no eventType (protobuf omits 0)', () => {
    expect(classifyInput(ev({ textEvent: {} }))).toBe('click')
    expect(classifyInput(ev({ textEvent: { eventType: T.CLICK_EVENT } }))).toBe('click')
    expect(classifyInput(ev({ listEvent: {} }))).toBe('click')
  })
  it('a bare sysEvent without eventType is also a tap', () => {
    expect(classifyInput(ev({ sysEvent: {} }))).toBe('click')
    expect(classifyInput(ev({ sysEvent: { eventSource: 1 } }))).toBe('click')
  })
  it('swipes and double tap', () => {
    expect(classifyInput(ev({ textEvent: { eventType: T.SCROLL_TOP_EVENT } }))).toBe('scroll_up')
    expect(classifyInput(ev({ textEvent: { eventType: T.SCROLL_BOTTOM_EVENT } }))).toBe('scroll_down')
    expect(classifyInput(ev({ textEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))).toBe('double_click')
    expect(classifyInput(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))).toBe('double_click')
  })
  it('lifecycle and exit', () => {
    expect(classifyInput(ev({ sysEvent: { eventType: T.FOREGROUND_ENTER_EVENT } }))).toBe('foreground')
    expect(classifyInput(ev({ sysEvent: { eventType: T.SYSTEM_EXIT_EVENT } }))).toBe('exit')
    expect(classifyInput(ev({ sysEvent: { eventType: T.ABNORMAL_EXIT_EVENT } }))).toBe('abnormal_exit')
  })
  it('IMU and empty events are not taps', () => {
    expect(classifyInput(ev({ sysEvent: { eventType: T.IMU_DATA_REPORT } }))).toBe('unknown')
    expect(classifyInput(ev({ sysEvent: { imuData: { x: 1 } } }))).toBe('unknown')
    expect(classifyInput(ev({}))).toBe('unknown')
  })
})

describe('listClick', () => {
  it('reads the picked item from a tap on the menu list; a missing index is the first item', () => {
    expect(listClick(ev({ listEvent: { currentSelectItemName: 'Exit', currentSelectItemIndex: 2 } }))).toEqual({ name: 'Exit', index: 2 })
    expect(listClick(ev({ listEvent: {} }))).toEqual({ name: undefined, index: undefined })
  })
  it('swipes and double taps on the list are not picks, and text events never are', () => {
    expect(listClick(ev({ listEvent: { eventType: T.SCROLL_BOTTOM_EVENT, currentSelectItemIndex: 1 } }))).toBeNull()
    expect(listClick(ev({ listEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))).toBeNull()
    expect(listClick(ev({ textEvent: {} }))).toBeNull()
  })
})
