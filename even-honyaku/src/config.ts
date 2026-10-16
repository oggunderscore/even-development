// Phone-reachable proxy address. In dev use your LAN IP (see .env.example); localhost won't work from the phone.
export const SERVER_URL = (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? 'ws://localhost:8787'
export const SERVER_TOKEN = (import.meta.env['VITE_SERVER_TOKEN'] as string | undefined) ?? ''

export const SAMPLE_RATE = 16000
/** Hard cap on one hold, so a stuck press can't stream audio forever. */
export const MAX_TURN_MS = 60_000

/** Human-readable summary for the debug log (token masked). */
export function describeConfig(): string {
  const tokenNote = SERVER_TOKEN ? `token set (${SERVER_TOKEN.length} chars)` : 'token EMPTY — VITE_SERVER_TOKEN missing from .env.local?'
  const hostNote = /localhost|127\.0\.0\.1/.test(SERVER_URL) ? ' — localhost only works in the simulator, a phone needs your LAN IP' : ''
  return `server ${SERVER_URL}${hostNote}; ${tokenNote}`
}
