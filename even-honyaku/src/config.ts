// Optional default for "server mode" only (the app talks to the providers directly otherwise). Users set their
// own address in Settings; nothing about a developer's test environment should be baked into a shared build.
export const SERVER_URL = (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? ''

export const SAMPLE_RATE = 16000
/** Hard cap on one hold, so a stuck press can't stream audio forever. */
export const MAX_TURN_MS = 60_000

/** Human-readable summary for the debug log. Never includes a key or the token itself. */
export function describeConfig(mode: 'direct' | 'server', url: string, token: string, keys: { deepgram: boolean; translate: boolean }): string {
  const keyNote = `keys: deepgram ${keys.deepgram ? 'set' : 'MISSING'}, translation ${keys.translate ? 'set' : 'MISSING'}`
  if (mode === 'direct') return `mode direct (calls Deepgram + translation provider from this device); ${keyNote}`
  const hostNote = /localhost|127\.0\.0\.1/.test(url) ? ' — localhost only works in the simulator; a phone needs your LAN/Tailscale address' : ''
  return `mode server ${url || '(no address)'}${hostNote}; token ${token ? `set (${token.length} chars)` : 'EMPTY'}; ${keyNote}`
}
