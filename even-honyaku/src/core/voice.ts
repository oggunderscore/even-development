// The voice filter's brain: who just spoke — the wearer or the other person?
//
// Three independent signals, cheapest first (see also echo.ts):
//   L0  echo      – the words match a reply we suggested and the wearer is reading it aloud (echo.ts)
//   L1  level     – the wearer's voice is much louder at the glasses mics than a person across the table
//   L2  voiceprint – spectral envelope + pitch compared with what the wearer enrolled (English AND Japanese)
// They are fused into a verdict: wearer / other / unsure. Everything stays on the device.

import type { Speaker, VoiceProfile, VoiceSample, VoiceSet } from '../protocol'
import { SAMPLE_RATE, VOICE_DIMS, type VoiceFeatures, pcmToFloat, speechLevelDb, voiceFeatures } from './dsp'

// ── audio timeline ───────────────────────────────────────────────────────────

/**
 * The last ~45 s of mic audio, addressed in seconds from when the STT stream opened — the same clock Deepgram uses
 * for the `start`/`duration` of every final, so a transcript can be matched to the exact audio that produced it.
 */
export class VoiceTimeline {
  private chunks: { at: number; data: Float32Array }[] = []
  private total = 0
  constructor(private readonly keepSec = 45) {}

  push(pcm: Uint8Array) {
    const data = pcmToFloat(pcm)
    if (!data.length) return
    this.chunks.push({ at: this.total, data })
    this.total += data.length
    const floor = this.total - this.keepSec * SAMPLE_RATE
    while (this.chunks.length > 1 && this.chunks[0]!.at + this.chunks[0]!.data.length < floor) this.chunks.shift()
  }

  get seconds(): number {
    return this.total / SAMPLE_RATE
  }

  /**
   * Let time pass without keeping the audio (nothing needs it right now). The clock must keep running so that when
   * audio is kept again, stream times still line up with Deepgram's.
   */
  advance(bytes: number) {
    this.total += bytes >> 1
    this.chunks = []
  }

  /** Audio between two stream times (a little padding either side), or null if it was never kept or has scrolled out. */
  slice(startSec: number, endSec: number, padSec = 0.08): Float32Array | null {
    const oldest = this.chunks[0]?.at
    if (oldest === undefined) return null
    // The speech itself must have been kept (a little slack for timestamp rounding); only the padding may be missing.
    if (startSec * SAMPLE_RATE < oldest - SAMPLE_RATE * 0.05) return null
    const from = Math.max(oldest, Math.floor((startSec - padSec) * SAMPLE_RATE))
    const to = Math.min(this.total, Math.ceil((endSec + padSec) * SAMPLE_RATE))
    if (to - from < SAMPLE_RATE * 0.1) return null
    const out = new Float32Array(to - from)
    for (const c of this.chunks) {
      const lo = Math.max(from, c.at)
      const hi = Math.min(to, c.at + c.data.length)
      if (hi > lo) out.set(c.data.subarray(lo - c.at, hi - c.at), lo - from)
    }
    return out
  }
}

// ── profile ──────────────────────────────────────────────────────────────────

export const emptyProfile = (): VoiceProfile => ({ v: 1, updated: 0, en: { seed: [], adapt: [] }, ja: { seed: [], adapt: [] } })

const MAX_ADAPT = 16
/** A voiceprint is trusted only with at least this many recorded samples in EACH language: the Japanese is what must be caught. */
export const MIN_PER_LANG = 2

export const seedCount = (p: VoiceProfile) => p.en.seed.length + p.ja.seed.length
export const profileReady = (p: VoiceProfile | null | undefined): p is VoiceProfile =>
  !!p && p.en.seed.length >= MIN_PER_LANG && p.ja.seed.length >= MIN_PER_LANG

const sampleOf = (f: VoiceFeatures): VoiceSample => ({ vec: f.vec.map((v) => Math.round(v * 10000) / 10000), levelDb: Math.round(f.levelDb * 100) / 100 })

export function withSeed(p: VoiceProfile, lang: 'en' | 'ja', f: VoiceFeatures): VoiceProfile {
  return { ...p, updated: Date.now(), [lang]: { ...p[lang], seed: [...p[lang].seed, sampleOf(f)] } }
}

/** Learn from a moment we are certain was the wearer. Old adaptive samples fall off; the enrolled ones never do. */
export function withLearned(p: VoiceProfile, lang: 'en' | 'ja', f: VoiceFeatures): VoiceProfile {
  const adapt = [...p[lang].adapt, sampleOf(f)].slice(-MAX_ADAPT)
  return { ...p, updated: Date.now(), [lang]: { ...p[lang], adapt } }
}

const isSample = (s: unknown): s is VoiceSample => {
  const o = s as VoiceSample
  return !!o && Array.isArray(o.vec) && o.vec.length === VOICE_DIMS && o.vec.every(Number.isFinite) && Number.isFinite(o.levelDb)
}
const parseSet = (s: unknown): VoiceSet => {
  const o = (s ?? {}) as Partial<VoiceSet>
  return { seed: (o.seed ?? []).filter(isSample).slice(0, 40), adapt: (o.adapt ?? []).filter(isSample).slice(-MAX_ADAPT) }
}

/** Stored JSON → a valid profile (anything malformed is dropped), or null. */
export function parseProfile(raw: unknown): VoiceProfile | null {
  try {
    const o = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<VoiceProfile> | null
    if (!o || o.v !== 1) return null
    return { v: 1, updated: Number(o.updated) || 0, en: parseSet(o.en), ja: parseSet(o.ja) }
  } catch {
    return null
  }
}

// ── scoring ──────────────────────────────────────────────────────────────────

/** Per-dimension floor on the spread, so a feature that happened to be steady during enrollment can't dominate. */
const FLOOR: number[] = [...Array(19).fill(0.6), ...Array(12).fill(0.35), 0.04, 0.03]

interface Model {
  centroids: number[][]
  scale: number[]
  /** Typical distance of an enrolled sample from the rest of its own set (leave-one-out). */
  intra: number
  level: { mean: number; std: number }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const centroidOf = (vs: number[][]) => Array.from({ length: VOICE_DIMS }, (_, k) => mean(vs.map((v) => v[k]!)))

const dist = (x: number[], c: number[], scale: number[]) => Math.sqrt(mean(x.map((v, k) => ((v - c[k]!) / scale[k]!) ** 2)))

const models = new WeakMap<VoiceProfile, Model | null>()

function buildModel(p: VoiceProfile): Model | null {
  const sets = [p.en, p.ja].map((s) => [...s.seed, ...s.adapt]).filter((s) => s.length > 0)
  if (!sets.length) return null
  const vecs = sets.map((s) => s.map((x) => x.vec))
  const centroids = vecs.map(centroidOf)

  // pooled within-set spread
  const ss = new Array<number>(VOICE_DIMS).fill(0)
  let df = 0
  vecs.forEach((vs, i) => {
    for (const v of vs) for (let k = 0; k < VOICE_DIMS; k++) ss[k]! += (v[k]! - centroids[i]![k]!) ** 2
    df += vs.length - 1
  })
  const scale = ss.map((s, k) => Math.max(df > 0 ? Math.sqrt(s / df) : 0, FLOOR[k]!))

  const loo: number[] = []
  vecs.forEach((vs) => {
    if (vs.length < 2) return
    vs.forEach((v, i) => loo.push(dist(v, centroidOf(vs.filter((_, j) => j !== i)), scale)))
  })
  const levels = sets.flat().map((s) => s.levelDb)
  const lm = mean(levels)
  return {
    centroids,
    scale,
    intra: Math.max(loo.length ? mean(loo) : 1.5, 0.8),
    level: { mean: lm, std: Math.max(Math.sqrt(mean(levels.map((l) => (l - lm) ** 2))), 2.5) },
  }
}

function modelOf(p: VoiceProfile): Model | null {
  if (!models.has(p)) models.set(p, buildModel(p))
  return models.get(p) ?? null
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const logit = (p: number, lo: number) => {
  const q = Math.min(1 - lo, Math.max(lo, p))
  return Math.log(q / (1 - q))
}

/** 0..1: how much this voice sounds like the enrolled wearer. */
export function voiceScore(p: VoiceProfile, f: VoiceFeatures, strictness: number): number {
  const m = modelOf(p)
  if (!m) return 0.5
  const r = Math.min(...m.centroids.map((c) => dist(f.vec, c, m.scale))) / m.intra
  return sigmoid((1.6 + 0.9 * strictness - r) * 3)
}

/** 0..1: how much this loudness fits the wearer's own voice at the mic (the other person is quieter). */
export function levelScore(p: VoiceProfile, levelDb: number, strictness: number): number {
  const m = modelOf(p)
  if (!m) return 0.5
  const z = (levelDb - m.level.mean) / m.level.std
  return sigmoid((z + 1.8 - (strictness - 0.5) * 1.5) * 1.8)
}

export interface Evidence {
  /** Best match against a reply we suggested, 0..1 (see echo.ts). */
  echo: number
  voice: number | null
  level: number | null
}

/** Echo score at which the words match a suggested reply closely enough to say the wearer is reading it out. */
export const ECHO_CERTAIN = 0.72
/** A weaker match: still worth a nudge. */
export const ECHO_LIKELY = 0.5

/**
 * Fuse the three signals into wearer / other / unsure.
 * - With no voiceprint at all, only an echo match can say "wearer"; everything else is "other" (how the app behaved
 *   before the voice filter existed).
 * - With a voiceprint, an echo match is a strong boost rather than a veto-proof override: if the other person happens
 *   to say the very phrase we suggested ("arigatou gozaimasu"), clearly different voice evidence still wins.
 */
export function verdict(e: Evidence): Speaker {
  const boost = e.echo >= ECHO_CERTAIN ? 3 : e.echo >= ECHO_LIKELY ? 1.5 : 0
  if (e.voice === null && e.level === null) return e.echo >= ECHO_CERTAIN ? 'wearer' : 'other'
  const total =
    (e.voice === null ? 0 : logit(e.voice, 0.02)) + (e.level === null ? 0 : logit(e.level, 0.05) * (e.voice === null ? 1 : 0.6)) + boost
  if (total >= 1.4) return 'wearer'
  if (total <= -1.4) return 'other'
  return 'unsure'
}

export interface Analysis {
  who: Speaker
  voice: number | null
  level: number | null
  features: VoiceFeatures | null
}

/**
 * Everything the filter knows about one utterance's audio. Used by the engine for every final, and by the Voice tab's
 * test so what you see there is exactly what the engine would decide. With no usable voiceprint it answers from
 * `echo` alone.
 */
export function analyze(profile: VoiceProfile | null, audio: Float32Array | null, strictness: number, echo = 0): Analysis {
  if (!profileReady(profile) || !audio) return { who: verdict({ echo, voice: null, level: null }), voice: null, level: null, features: null }
  const features = voiceFeatures(audio)
  const levelDb = features?.levelDb ?? speechLevelDb(audio)
  const voice = features ? voiceScore(profile, features, strictness) : null
  const level = levelDb === null ? null : levelScore(profile, levelDb, strictness)
  return { who: verdict({ echo, voice, level }), voice, level, features }
}

/** How trustworthy an enrollment looks, for the Voice tab. */
export function profileQuality(p: VoiceProfile): { label: 'good' | 'ok' | 'weak'; samples: number } {
  const samples = seedCount(p)
  const m = modelOf(p)
  if (!m || !profileReady(p)) return { label: 'weak', samples }
  const accepted = [p.en, p.ja].flatMap((s) => s.seed).filter((s) => voiceScore(p, { vec: s.vec, levelDb: s.levelDb, voicedSec: 1 }, 0.5) > 0.5).length
  return { label: samples >= 8 && accepted / samples >= 0.85 ? 'good' : 'ok', samples }
}
