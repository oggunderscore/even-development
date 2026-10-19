// Small, dependency-free speech features for the voice filter: PCM → MFCC + pitch → one "voice vector" per utterance.
// Pure TypeScript so it runs in the WebView and in Node tests. It is a classical voiceprint (spectral envelope +
// pitch), not a neural embedding; the voice filter combines it with the speaking level and with matching the
// replies we suggested, so it never has to be perfect on its own.

export const SAMPLE_RATE = 16000
const FRAME = 512 // 32 ms
const HOP = 256 // 16 ms
const MELS = 26
const COEFS = 20 // c0..c19; c0 (loudness) is dropped
const PRE_EMPHASIS = 0.97

/** Little-endian signed 16-bit PCM → floats in [-1, 1). Tolerates an odd byteOffset and a trailing odd byte. */
export function pcmToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1
  const out = new Float32Array(n)
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

// ── FFT ──────────────────────────────────────────────────────────────────────

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>()

function twiddle(n: number) {
  let t = twiddles.get(n)
  if (!t) {
    const cos = new Float64Array(n / 2)
    const sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n)
      sin[i] = -Math.sin((2 * Math.PI * i) / n)
    }
    t = { cos, sin }
    twiddles.set(n, t)
  }
  return t
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  const { cos, sin } = twiddle(n)
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!
        const wi = sin[k * step]!
        const a = i + k
        const b = a + half
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
      }
    }
  }
}

// ── mel filterbank + DCT ─────────────────────────────────────────────────────

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700)
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1)

let melBank: Float64Array[] | undefined
function filterbank(): Float64Array[] {
  if (melBank) return melBank
  const bins = FRAME / 2 + 1
  const lo = hz2mel(80)
  const hi = hz2mel(7600)
  const edges = Array.from({ length: MELS + 2 }, (_, i) => Math.floor(((FRAME + 1) * mel2hz(lo + ((hi - lo) * i) / (MELS + 1))) / SAMPLE_RATE))
  melBank = Array.from({ length: MELS }, (_, m) => {
    const f = new Float64Array(bins)
    const [l, c, r] = [edges[m]!, edges[m + 1]!, edges[m + 2]!]
    for (let k = l; k < c; k++) f[k] = (k - l) / Math.max(1, c - l)
    for (let k = c; k < r; k++) f[k] = (r - k) / Math.max(1, r - c)
    return f
  })
  return melBank
}

let dctBasis: Float64Array[] | undefined
function dct(): Float64Array[] {
  dctBasis ??= Array.from({ length: COEFS }, (_, k) => Float64Array.from({ length: MELS }, (_, m) => Math.cos((Math.PI * k * (m + 0.5)) / MELS)))
  return dctBasis
}

let hamming: Float64Array | undefined
const window = () => (hamming ??= Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1))))

/** MFCC c0..c19 for one 512-sample frame. */
function mfccFrame(x: Float32Array, at: number): Float64Array {
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const w = window()
  for (let i = 0; i < FRAME; i++) {
    const prev = at + i > 0 ? x[at + i - 1]! : 0
    re[i] = (x[at + i]! - PRE_EMPHASIS * prev) * w[i]!
  }
  fft(re, im)
  const power = new Float64Array(FRAME / 2 + 1)
  for (let k = 0; k < power.length; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!
  const logMel = filterbank().map((f) => {
    let s = 0
    for (let k = 0; k < f.length; k++) s += f[k]! * power[k]!
    return Math.log(s + 1e-10)
  })
  return Float64Array.from(dct(), (basis) => basis.reduce((s, b, m) => s + b * logMel[m]!, 0))
}

// ── energy / pitch ───────────────────────────────────────────────────────────

/** Mean-square energy of a frame in dBFS (full-scale sine ≈ -3 dB). */
function frameDb(x: Float32Array, at: number): number {
  let s = 0
  for (let i = 0; i < FRAME; i++) s += x[at + i]! * x[at + i]!
  return 10 * Math.log10(s / FRAME + 1e-12)
}

const MIN_LAG = Math.floor(SAMPLE_RATE / 400)
const MAX_LAG = Math.ceil(SAMPLE_RATE / 70)

/** Autocorrelation pitch: returns F0 in Hz, or 0 when the frame isn't clearly voiced. */
function pitch(x: Float32Array, at: number): number {
  let r0 = 0
  for (let i = 0; i < FRAME; i++) r0 += x[at + i]! * x[at + i]!
  if (r0 < 1e-9) return 0
  const r = new Float64Array(MAX_LAG + 1)
  let best = 0
  for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
    let s = 0
    for (let i = 0; i + lag < FRAME; i++) s += x[at + i]! * x[at + i + lag]!
    // compensate the shrinking overlap so a lag near 2 periods isn't penalised
    r[lag] = (s / r0) * (FRAME / (FRAME - lag))
    if (r[lag]! > best) best = r[lag]!
  }
  if (best < 0.5) return 0
  // the first strong peak, not the strongest: avoids octave-down errors
  for (let lag = MIN_LAG + 1; lag < MAX_LAG; lag++) {
    if (r[lag]! >= 0.9 * best && r[lag]! >= r[lag - 1]! && r[lag]! >= r[lag + 1]!) return SAMPLE_RATE / lag
  }
  return 0
}

// ── voice vector ─────────────────────────────────────────────────────────────

export interface VoiceFeatures {
  /** mean c1..c19, std c1..c12, mean ln F0, std ln F0 */
  vec: number[]
  /** How loud the speech was at the mic, dBFS (mean of the voiced frames). */
  levelDb: number
  voicedSec: number
}

export const VOICE_DIMS = 19 + 12 + 2
/** Need at least this many voiced frames (~0.4 s) for a trustworthy vector. */
const MIN_VOICED_FRAMES = 25

/** Level only: mean dBFS of the louder frames. Works on very short utterances where no voice vector can. */
export function speechLevelDb(x: Float32Array): number | null {
  if (x.length < FRAME) return null
  const dbs: number[] = []
  for (let at = 0; at + FRAME <= x.length; at += HOP) dbs.push(frameDb(x, at))
  const max = Math.max(...dbs)
  const loud = dbs.filter((d) => d >= max - 20 && d > -65)
  return loud.length ? loud.reduce((a, b) => a + b, 0) / loud.length : null
}

/** One utterance → its voice vector, or null if there isn't enough clearly-voiced speech. */
export function voiceFeatures(x: Float32Array): VoiceFeatures | null {
  if (x.length < FRAME * 3) return null
  const dbs: number[] = []
  const starts: number[] = []
  for (let at = 0; at + FRAME <= x.length; at += HOP) {
    starts.push(at)
    dbs.push(frameDb(x, at))
  }
  const max = Math.max(...dbs)
  const gate = Math.max(max - 28, -62)

  const cep: Float64Array[] = []
  const logF0: number[] = []
  const levels: number[] = []
  starts.forEach((at, i) => {
    if (dbs[i]! < gate) return
    const f0 = pitch(x, at)
    if (f0 === 0) return
    cep.push(mfccFrame(x, at))
    logF0.push(Math.log(f0))
    levels.push(dbs[i]!)
  })
  if (cep.length < MIN_VOICED_FRAMES) return null

  const n = cep.length
  const mean = (get: (c: Float64Array) => number) => cep.reduce((s, c) => s + get(c), 0) / n
  const vec: number[] = []
  const means: number[] = []
  for (let k = 1; k < COEFS; k++) {
    const m = mean((c) => c[k]!)
    means.push(m)
    vec.push(m)
  }
  for (let k = 1; k <= 12; k++) vec.push(Math.sqrt(mean((c) => (c[k]! - means[k - 1]!) ** 2)))
  const mf0 = logF0.reduce((a, b) => a + b, 0) / n
  vec.push(mf0, Math.sqrt(logF0.reduce((s, v) => s + (v - mf0) ** 2, 0) / n))

  return { vec, levelDb: levels.reduce((a, b) => a + b, 0) / n, voicedSec: (n * HOP) / SAMPLE_RATE }
}
