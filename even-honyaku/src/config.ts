// Phone-reachable proxy address. In dev use your LAN IP (see .env.example); localhost won't work from the phone.
export const SERVER_URL = (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? 'ws://localhost:8787'
export const SERVER_TOKEN = (import.meta.env['VITE_SERVER_TOKEN'] as string | undefined) ?? ''

export const SAMPLE_RATE = 16000
/** Hard cap on one hold, so a stuck press can't stream audio forever. */
export const MAX_TURN_MS = 60_000

/** Human-readable summary for the debug log. Never includes a key or the token itself. */
export function describeConfig(url: string, token: string, keys: { deepgram: boolean; translate: boolean }): string {
  const hostNote = /localhost|127\.0\.0\.1/.test(url) ? ' — localhost only works in the simulator; a phone needs your LAN/Tailscale address' : ''
  return `server ${url}${hostNote}; token ${token ? `set (${token.length} chars)` : 'EMPTY'}; keys: deepgram ${keys.deepgram ? 'set' : 'MISSING'}, translation ${keys.translate ? 'set' : 'MISSING'}`
}
