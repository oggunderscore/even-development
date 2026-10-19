// Double tap on the home page → the system exit confirmation (shutDownPageContainer(1)). The store requires exactly
// this on the root page: mode 0 (immediate exit) is only for cleanup after the user has already confirmed. Nothing is
// torn down first, so if the user answers "No" listening and every gesture keep working; if they answer "Yes" the OS
// closes the app and a SYSTEM_EXIT event stops the capture.

export interface ExitBridge {
  shutDownPageContainer(mode: number): Promise<boolean>
}

/** Ask the glasses to show the exit confirmation. Returns whether the request was accepted. */
export async function requestExit(bridge: ExitBridge | null): Promise<boolean> {
  try {
    return (await bridge?.shutDownPageContainer(1)) === true
  } catch {
    return false // the next double tap simply tries again
  }
}
