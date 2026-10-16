// Turns a raw Even Hub event into one of our gestures.
//
// Where each gesture arrives (SDK 0.0.14+, see even-realities-docs/build/device-apis.md):
//   - tap / double tap / swipe: on the capturing container (`textEvent` / `listEvent`); a tap is eventType 0,
//     which protobuf omits, so a *missing* eventType means CLICK.
//   - long press + release: always on `sysEvent`, whichever container captures (Even App 2.2.9+).
//   - lifecycle (foreground / exit) and IMU: `sysEvent`.
// A bare `sysEvent` with no eventType is also a protobuf-omitted CLICK.

import { type EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk'

export type GlassesInput =
  | 'click'
  | 'double_click'
  | 'scroll_up'
  | 'scroll_down'
  | 'long_press'
  | 'long_press_release'
  | 'foreground'
  | 'exit'
  | 'unknown'

function fromType(type: OsEventTypeList | undefined): GlassesInput {
  switch (type ?? OsEventTypeList.CLICK_EVENT) {
    case OsEventTypeList.CLICK_EVENT:
      return 'click'
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'double_click'
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'scroll_up'
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'scroll_down'
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'long_press'
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return 'long_press_release'
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return 'foreground'
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
      return 'exit'
    default:
      return 'unknown' // FOREGROUND_EXIT, IMU_DATA_REPORT, …
  }
}

export function classifyInput(event: EvenHubEvent): GlassesInput {
  const sys = event.sysEvent
  if (sys?.eventType !== undefined) return fromType(sys.eventType)

  const part = event.textEvent ?? event.listEvent
  if (part) return fromType(part.eventType)

  // sysEvent present but eventType omitted: a tap (unless it is carrying IMU / exit data).
  if (sys && sys.imuData === undefined && sys.systemExitReasonCode === undefined) return 'click'
  return 'unknown'
}
