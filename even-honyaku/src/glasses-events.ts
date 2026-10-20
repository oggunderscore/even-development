// Everything the glasses send us that isn't audio, turned into actions. Kept out of main.ts so the wiring can be tested:
// in particular that a double tap reaches shutDownPageContainer(1) (the system exit confirmation the store requires on
// the home page), called right here in the double-tap branch.

import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { classifyInput, menuClick } from './input'

export interface GlassesBridge {
  shutDownPageContainer(mode: number): Promise<boolean>
}

export interface GlassesActions {
  /** The Even bridge (looked up each time: it exists as soon as the app is open, before the rest of start-up finishes). */
  bridge(): GlassesBridge | null
  toggleListening(): void
  scroll(direction: 'up' | 'down'): void
  /** A pick from the OS contextual menu (our item ids). */
  menuPick(itemID: number): void
  resumeCapture(): void
  haltCapture(): void
  /** A short message for the wearer (the exit dialog could not be opened). */
  note(text: string): void
}

/** A single tap waits this long for a possible second tap, so a double tap (exit) never also toggles listening. */
export const SINGLE_TAP_MS = 350
const SCROLL_DEBOUNCE_MS = 300
/** One exit dialog per double tap, however many events the firmware sends for it. */
const EXIT_DEBOUNCE_MS = 1000
const EXIT_RETRY_MS = 400

export function createGlassesEventHandler(actions: GlassesActions): (event: EvenHubEvent) => void {
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  let lastScrollAt = 0
  let lastExitAt = 0
  /** The OS told us the app is closing (or its capture is gone); recover on the next sign of life. */
  let suspended = false

  /** Double tap on the home page → the system exit confirmation. Nothing is torn down: the user may answer "No". */
  const openExitDialog = () => {
    const now = Date.now()
    if (now - lastExitAt < EXIT_DEBOUNCE_MS) return
    lastExitAt = now
    const ask = async (): Promise<boolean> => {
      try {
        return (await actions.bridge()?.shutDownPageContainer(1)) === true
      } catch {
        return false
      }
    }
    void ask().then((ok) => {
      if (ok) return
      // Refused (a page rebuild may have been in flight): try once more, then say so instead of failing silently.
      setTimeout(() => {
        void ask().then((again) => {
          if (!again) actions.note('Could not open the exit dialog. Double tap again.')
        })
      }, EXIT_RETRY_MS)
    })
  }

  return (event) => {
    const pick = menuClick(event)
    if (pick !== null) {
      actions.menuPick(pick)
      return
    }

    const input = classifyInput(event)

    // Any sign of life after the OS closed our session (e.g. the exit dialog was answered "No") brings capture back.
    const wasSuspended = suspended
    if (suspended && input !== 'exit' && input !== 'unknown' && input !== 'long_press_release') {
      suspended = false
      if (input !== 'long_press') actions.resumeCapture()
    }

    switch (input) {
      case 'double_click':
        clearTimeout(tapTimer) // the first tap of this double tap must not also toggle listening
        openExitDialog()
        break
      case 'exit':
        // The app is closing. Stop streaming, but stay subscribed in case it isn't (the user can still get back in).
        suspended = true
        actions.haltCapture()
        break
      case 'abnormal_exit':
      case 'foreground':
        // Capture stops when the WebView is suspended and Deepgram's sockets drop; rebuild both.
        actions.resumeCapture()
        break
      case 'scroll_up':
      case 'scroll_down': {
        const now = Date.now()
        if (now - lastScrollAt > SCROLL_DEBOUNCE_MS) {
          lastScrollAt = now
          actions.scroll(input === 'scroll_up' ? 'up' : 'down')
        }
        break
      }
      case 'click':
        // Pause / resume listening. (A tap that merely woke the app after an exit dialog was answered "No" has already
        // re-armed capture; it should not also pause it.)
        if (wasSuspended) break
        clearTimeout(tapTimer)
        tapTimer = setTimeout(() => actions.toggleListening(), SINGLE_TAP_MS)
        break
      default:
        break // long press is deliberately unused
    }
  }
}
