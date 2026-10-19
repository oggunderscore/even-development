import { describe, expect, it } from 'vitest'
import { OTHER, WEARER, synthVoice, toPcm } from '../test/synth'
import { VOICE_DIMS, fft, pcmToFloat, speechLevelDb, voiceFeatures } from './dsp'
import { ECHO_CERTAIN, VoiceTimeline, emptyProfile, levelScore, parseProfile, profileQuality, profileReady, verdict, voiceScore, withLearned, withSeed } from './voice'

const feat = (spk: typeof WEARER, seed: number, levelDb = -22, seconds = 2.5) => {
  const f = voiceFeatures(synthVoice(spk, { seed, levelDb, seconds }))
  if (!f) throw new Error('no features')
  return f
}

function enrolled() {
  let p = emptyProfile()
  for (let i = 1; i <= 4; i++) p = withSeed(p, 'en', feat(WEARER, i))
  for (let i = 5; i <= 8; i++) p = withSeed(p, 'ja', feat(WEARER, i))
  return p
}

describe('dsp', () => {
  it('pcmToFloat reads little-endian s16 even from an odd byte offset', () => {
    const bytes = toPcm(Float32Array.from([0.5, -0.5, 0.25]))
    const shifted = new Uint8Array(bytes.length + 1)
    shifted.set(bytes, 1)
    const out = pcmToFloat(shifted.subarray(1))
    expect(Array.from(out)).toEqual([0.5, -0.5, 0.25])
  })

  it('fft puts a sine in the right bin', () => {
    const n = 512
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 32 * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k]!, im[k]!))
    expect(mag.indexOf(Math.max(...mag))).toBe(32)
  })

  it('voiceFeatures: fixed length, pitch near the speaker, level near the target', () => {
    const f = feat(WEARER, 3, -20)
    expect(f.vec).toHaveLength(VOICE_DIMS)
    expect(f.vec.every(Number.isFinite)).toBe(true)
    expect(Math.exp(f.vec[31]!)).toBeGreaterThan(100)
    expect(Math.exp(f.vec[31]!)).toBeLessThan(140)
    expect(f.levelDb).toBeGreaterThan(-26)
    expect(f.levelDb).toBeLessThan(-14)
  })

  it('too little speech yields no voice vector, silence has no level', () => {
    expect(voiceFeatures(new Float32Array(16000))).toBeNull()
    expect(voiceFeatures(synthVoice(WEARER, { seconds: 0.2 }))).toBeNull()
    expect(speechLevelDb(new Float32Array(100))).toBeNull()
  })
})

describe('VoiceTimeline', () => {
  it('addresses audio by stream time, whatever the chunk size', () => {
    const x = Float32Array.from({ length: 16000 * 4 }, (_, i) => (i % 1000) / 2000)
    const pcm = toPcm(x)
    const t = new VoiceTimeline()
    for (let at = 0; at < pcm.length; at += 641 * 2) t.push(pcm.subarray(at, Math.min(pcm.length, at + 641 * 2)))
    expect(t.seconds).toBeCloseTo(4, 1)
    const s = t.slice(1, 2, 0)!
    expect(s.length).toBe(16000)
    expect(s[0]).toBeCloseTo(x[16000]!, 3)
    expect(s[15999]).toBeCloseTo(x[31999]!, 3)
  })

  it('forgets old audio and refuses ranges that scrolled out', () => {
    const t = new VoiceTimeline(2)
    const chunk = toPcm(new Float32Array(16000))
    for (let i = 0; i < 6; i++) t.push(chunk)
    expect(t.slice(0, 1)).toBeNull()
    expect(t.slice(4.5, 5.5)).not.toBeNull()
  })
})

describe('voiceprint', () => {
  const p = enrolled()

  it('is ready only with enough enrolled samples', () => {
    expect(profileReady(emptyProfile())).toBe(false)
    expect(profileReady(p)).toBe(true)
    expect(profileQuality(p).label).toBe('good')
  })

  it('the wearer scores high on new utterances, a different voice scores low', () => {
    for (const seed of [21, 22, 23]) {
      expect(voiceScore(p, feat(WEARER, seed), 0.5)).toBeGreaterThan(0.7)
      expect(voiceScore(p, feat(OTHER, seed), 0.5)).toBeLessThan(0.3)
    }
  })

  it('level: the wearer at their usual loudness vs. a much quieter voice', () => {
    expect(levelScore(p, -22, 0.5)).toBeGreaterThan(0.8)
    expect(levelScore(p, -40, 0.5)).toBeLessThan(0.1)
  })

  it('a similar-sounding voice still ranks below the wearer', () => {
    const similar = { f0: 130, formants: [610, 1260, 2560] as [number, number, number] }
    const w = [31, 32, 33].map((s) => voiceScore(p, feat(WEARER, s), 0.5))
    const o = [31, 32, 33].map((s) => voiceScore(p, feat(similar, s), 0.5))
    expect(Math.min(...w)).toBeGreaterThan(Math.max(...o))
  })

  it('strictness makes the filter readier to call a voice the wearer', () => {
    const f = feat(OTHER, 30)
    expect(voiceScore(p, f, 1)).toBeGreaterThanOrEqual(voiceScore(p, f, 0))
  })

  it('learning from a confirmed moment adds an adaptive sample but never touches the enrolled ones', () => {
    const q = withLearned(p, 'ja', feat(WEARER, 40))
    expect(q.ja.adapt).toHaveLength(1)
    expect(q.ja.seed).toEqual(p.ja.seed)
    let r = q
    for (let i = 0; i < 30; i++) r = withLearned(r, 'en', feat(WEARER, 50 + i % 3))
    expect(r.en.adapt.length).toBeLessThanOrEqual(16)
  })

  it('parseProfile survives round-trips and rejects junk', () => {
    expect(parseProfile(JSON.stringify(p))).toEqual(p)
    expect(parseProfile('nope')).toBeNull()
    expect(parseProfile({ v: 2 })).toBeNull()
    const bad = { ...p, en: { seed: [{ vec: [1, 2], levelDb: -20 }], adapt: [] } }
    expect(parseProfile(bad)?.en.seed).toEqual([])
  })
})

describe('verdict (fusion)', () => {
  it('without a voiceprint, matching a suggested reply is what proves the wearer said it', () => {
    expect(verdict({ echo: ECHO_CERTAIN, voice: null, level: null })).toBe('wearer')
    expect(verdict({ echo: 0.6, voice: null, level: null })).toBe('other')
  })
  it('with a voiceprint, an echo match is a strong boost that clearly different voice evidence can still outvote', () => {
    expect(verdict({ echo: ECHO_CERTAIN, voice: 0.5, level: 0.5 })).toBe('wearer')
    expect(verdict({ echo: ECHO_CERTAIN, voice: 0.02, level: 0.02 })).not.toBe('wearer')
  })
  it('no voiceprint and no echo → other (the pre-1.1 behaviour)', () => {
    expect(verdict({ echo: 0, voice: null, level: null })).toBe('other')
  })
  it('agreeing signals decide, disagreeing ones are unsure', () => {
    expect(verdict({ echo: 0, voice: 0.9, level: 0.9 })).toBe('wearer')
    expect(verdict({ echo: 0, voice: 0.05, level: 0.1 })).toBe('other')
    expect(verdict({ echo: 0, voice: 0.85, level: 0.02 })).toBe('unsure')
    expect(verdict({ echo: 0, voice: 0.5, level: 0.5 })).toBe('unsure')
  })
  it('level alone can decide when the utterance is too short for a voice vector', () => {
    expect(verdict({ echo: 0, voice: null, level: 0.95 })).toBe('wearer')
    expect(verdict({ echo: 0, voice: null, level: 0.03 })).toBe('other')
  })
})
