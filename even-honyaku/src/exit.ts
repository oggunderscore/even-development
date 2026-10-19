// The menu's Exit item: leave the app at once, with no confirmation. Choosing Exit from our own menu is already a
// deliberate act, so there is no "Are you sure?" step (that is what shutDownPageContainer(1), the system dialog, adds).
// Capture is stopped first: with no "No" answer to come back from, there is nothing to keep running.

export interface ExitBridge {
  shutDownPageContainer(mode: number): Promise<boolean>
}

/** Stop listening, then close the app immediately. Returns false (and re-arms capture) if the glasses refused. */
export async function exitImmediately(bridge: ExitBridge | null, stopCapture: () => Promise<void>, resumeCapture: () => Promise<void>): Promise<boolean> {
  await stopCapture()
  let closed = false
  try {
    closed = (await bridge?.shutDownPageContainer(0)) === true // mode 0 = immediate, no system dialog
  } catch {
    /* treated as refused */
  }
  if (!closed) await resumeCapture() // still here: carry on listening
  return closed
}
