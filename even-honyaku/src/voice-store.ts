// The wearer's voiceprint, kept on this device only (the Even bridge store, mirrored to localStorage) and never sent
// anywhere. Separate from the API-key settings so the engine's small adaptive updates don't rewrite the keys.

import type { VoiceProfile } from './protocol'
import { parseProfile } from './core/voice'

export const VOICE_KEY = 'honyaku.voice.v1'

type BridgeStorage = { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> }

function readLocal(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

export const loadVoice = (): VoiceProfile | null => parseProfile(readLocal())

export async function loadVoiceFromBridge(bridge: BridgeStorage): Promise<VoiceProfile | null> {
  try {
    const fromBridge = parseProfile(await bridge.getLocalStorage(VOICE_KEY))
    if (fromBridge) return fromBridge
  } catch {
    /* fall through to localStorage */
  }
  const local = parseProfile(readLocal())
  if (local) void bridge.setLocalStorage(VOICE_KEY, JSON.stringify(local)).catch(() => {})
  return local
}

/** `null` deletes the voiceprint. */
export async function saveVoice(profile: VoiceProfile | null, bridge?: BridgeStorage | null): Promise<void> {
  const json = profile ? JSON.stringify(profile) : ''
  try {
    if (profile) localStorage.setItem(VOICE_KEY, json)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    /* private mode etc. */
  }
  await bridge?.setLocalStorage(VOICE_KEY, json).catch(() => {})
}
