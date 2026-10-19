import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList as T } from '@evenrealities/even_hub_sdk'
import { describe, expect, it } from 'vitest'
import { classifyInput, menuClick } from './input'

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

describe('menuClick', () => {
  it('reads the picked item id from the OS contextual menu', () => {
    expect(menuClick(ev({ menuItemClickEvent: { itemID: 3 } }))).toBe(3)
  })
  it('is null for every other event', () => {
    expect(menuClick(ev({ menuItemClickEvent: {} }))).toBeNull()
    expect(menuClick(ev({ textEvent: {} }))).toBeNull()
    expect(menuClick(ev({ sysEvent: { eventType: T.DOUBLE_CLICK_EVENT } }))).toBeNull()
  })
})
