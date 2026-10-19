// Test-only: synthetic "speakers" for the voice-filter tests. A glottal pulse train at the speaker's pitch is shaped by
// three formant resonators; the formants drift every ~0.18 s like a run of vowels. Two speakers differ in pitch and
// formant layout, and every utterance differs in its vowel sequence. This proves the plumbing and that the features
// separate clearly different voices; it says nothing about real-world accuracy (that needs recordings from the glasses).

export interface Speaker {
  f0: number
  /** F1..F3 in Hz */
  formants: [number, number, number]
}

export const WEARER: Speaker = { f0: 118, formants: [640, 1190, 2480] }
export const OTHER: Speaker = { f0: 205, formants: [470, 1750, 2900] }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function synthVoice(spk: Speaker, opts: { seconds?: number; seed?: number; levelDb?: number; sampleRate?: number } = {}): Float32Array {
  const { seconds = 2.5, seed = 1, levelDb = -22, sampleRate = 16000 } = opts
  const rand = rng(seed)
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  const seg = Math.floor(0.18 * sampleRate)

  // Per-segment pitch and formants (drifting like a run of vowels).
  const segs = Math.ceil(n / seg)
  const segF0 = Array.from({ length: segs }, () => spk.f0 * (1 + (rand() - 0.5) * 0.12))
  const segFormants = Array.from({ length: segs }, () => spk.formants.map((f) => f * (1 + (rand() - 0.5) * 0.28)) as [number, number, number])

  // Glottal pulses with an integer period per segment, so voiced stretches are exactly periodic like real speech.
  const excitation = new Float64Array(n + 2)
  for (let t = 0; t < n; ) {
    excitation[t]! += 1
    t += Math.round(sampleRate / segF0[Math.min(segs - 1, Math.floor(t / seg))]!)
  }

  const state = [
    { y1: 0, y2: 0 },
    { y1: 0, y2: 0 },
    { y1: 0, y2: 0 },
  ]
  for (let i = 0; i < n; i++) {
    const formants = segFormants[Math.floor(i / seg)]!
    let y = excitation[i]!
    for (let k = 0; k < 3; k++) {
      const r = Math.exp((-Math.PI * (60 + 40 * k)) / sampleRate)
      const a1 = 2 * r * Math.cos((2 * Math.PI * formants[k]!) / sampleRate)
      const a2 = -r * r
      const s = state[k]!
      const v = y * (1 - r) + a1 * s.y1 + a2 * s.y2
      s.y2 = s.y1
      s.y1 = v
      y = v
    }
    // gentle attack/decay so utterances start and end in silence
    const env = Math.min(1, i / 1600, (n - i) / 1600)
    out[i] = y * env
  }
  // scale to the requested speech level (mean-square, dBFS), then add a background ~42 dB below the speech
  let ms = 0
  for (const v of out) ms += v * v
  const gain = Math.sqrt(10 ** (levelDb / 10) / (ms / n + 1e-18))
  const noise = 10 ** ((levelDb - 42) / 20) * Math.sqrt(3)
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain + (rand() * 2 - 1) * noise
  return out
}

/** Float → little-endian s16 PCM, the way the glasses deliver it. */
export function toPcm(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < x.length; i++) view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32768))), true)
  return out
}
