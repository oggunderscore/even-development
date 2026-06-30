/**
 * Right-temple touch -> Flipper button routing.
 *
 * We map G2 right-temple gestures (TOUCH_EVENT_FROM_GLASSES_R) to a minimal
 * 4-button subset of the Flipper d-pad:
 *   SCROLL_TOP_EVENT    -> up    (short)
 *   SCROLL_BOTTOM_EVENT -> down  (short)
 *   CLICK_EVENT         -> ok    (short)
 *   DOUBLE_CLICK_EVENT  -> back  (short)
 *
 * Future-work / fallback note:
 *   If temple gestures prove unreliable in practice, or we need full d-pad
 *   coverage (left/right/long-press), switch to a list-container approach:
 *   create a `ListContainerProperty` with items `[Up, Down, Left, Right, OK,
 *   Back]` and `isEventCapture:1`. The user then highlights an item via the
 *   normal G2 list UI and clicks to fire it. This costs an extra click per
 *   action but exposes the full button set without ambiguous gestures.
 */

import {
  OsEventTypeList,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'

import type { ButtonAction, ButtonKey } from './flipper-client.ts'

export type SendButton = (key: ButtonKey, action: ButtonAction) => void

/** App lifecycle signal, delivered via sysEvent (eventType 4-7). */
export type Lifecycle = 'foreground' | 'background' | 'exit'

export type LifecycleHandler = (event: Lifecycle) => void

export function startInputRouting(
  bridge: EvenAppBridge,
  send: SendButton,
  onLifecycle?: LifecycleHandler,
): () => void {
  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    // The simulator routes most gestures as textEvent from the dedicated
    // event-capture container (containerID=2). sysEvent fires for some
    // direct temple-touch events. Handle both: same OsEventTypeList values
    // for both routes.
    const text = event.textEvent
    const sys = event.sysEvent
    if (text || sys) {
      console.warn('[input] hit', JSON.stringify({ text, sys }))
    }
    if (text && text.containerName === 'gestures') {
      const key = mapEvent(text.eventType)
      if (key) send(key, 'short')
      return
    }
    if (!sys) return
    // Lifecycle events (foreground enter / exit / abnormal+system exit) arrive
    // on sysEvent too. Intercept them BEFORE button mapping: they share the
    // sysEvent channel with temple clicks, but mapEvent() already returns null
    // for 4-7 so they were silently dropped. We now act on them - in
    // particular foreground-enter drives the reconnect that fixes the frozen
    // "connecting…" on app return.
    const lifecycle = mapLifecycle(sys.eventType)
    if (lifecycle) {
      onLifecycle?.(lifecycle)
      return
    }
    const key = mapEvent(sys.eventType)
    if (key) send(key, 'short')
  })
}

function mapLifecycle(t: OsEventTypeList | undefined): Lifecycle | null {
  switch (t) {
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return 'foreground'
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return 'background'
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return 'exit'
    default:
      return null
  }
}

function mapEvent(t: OsEventTypeList | undefined): ButtonKey | null {
  // Per the input-events guide, the SDK normalizes CLICK_EVENT (0) to
  // `undefined` in some cases, so a missing eventType means a single click.
  const v = t ?? OsEventTypeList.CLICK_EVENT
  // G2 exposes exactly four gestures (press, double-press, swipe up, swipe
  // down). Flipper's left/right d-pad keys are unreachable via temple touch;
  // they would need the ListContainerProperty fallback described above.
  switch (v) {
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'up'
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'down'
    case OsEventTypeList.CLICK_EVENT:
      return 'ok'
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'back'
    default:
      return null
  }
}
