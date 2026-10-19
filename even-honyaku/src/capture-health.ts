// Is capture still working? The app re-arms the mic and the speech stream when it may have been lost (the WebView was
// suspended, the phone was locked, the OS says "foreground"). But FOREGROUND_ENTER / FOREGROUND_EXIT also fire every
// time the wearer opens and closes the OS contextual menu, with the app never leaving, so re-arming on every such
// event would restart a healthy stream (cutting off a phrase mid-sentence) each time the menu is used.
// Real loss is visible in the data: no audio for a while, or the stream gave up. Re-arm only then.

/** Audio normally arrives many times a second; this long without any means capture is gone. */
export const AUDIO_STALE_MS = 3000

export interface CaptureState {
  micOpen: boolean
  /** When the last mic chunk arrived (ms since epoch), 0 if none yet. */
  lastAudioAt: number
  /** The speech-to-text stream is open (the engine hasn't given up reconnecting). */
  streaming: boolean
}

export function captureHealthy(s: CaptureState, now = Date.now()): boolean {
  return s.micOpen && s.streaming && s.lastAudioAt > 0 && now - s.lastAudioAt < AUDIO_STALE_MS
}
