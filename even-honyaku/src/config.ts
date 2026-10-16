export const SAMPLE_RATE = 16000
/** Hard cap on one hold, so a stuck press can't stream audio forever. */
export const MAX_TURN_MS = 60_000

/** Human-readable summary for the debug log. Never includes a key. */
export function describeConfig(keys: { deepgram: boolean; translate: boolean }): string {
  return `engine runs on this device; keys: deepgram ${keys.deepgram ? 'set' : 'MISSING'}, translation ${keys.translate ? 'set' : 'MISSING'}`
}
