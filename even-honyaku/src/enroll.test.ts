import { describe, expect, it } from 'vitest'
import { Segmenter } from './core/vad'
import { WEARER, synthVoice, toPcm } from './test/synth'
import { Enrollment, PROMPTS, type Prompt } from './enroll'

describe('Segmenter', () => {
  const silence = (sec: number) => new Uint8Array(Math.floor(sec * 16000) * 2)
  const feed = (seg: Segmenter, pcm: Uint8Array) => {
    for (let at = 0; at < pcm.length; at += 3200) seg.push(pcm.subarray(at, at + 3200))
  }

  it('cuts speech out of silence and ignores the quiet between', () => {
    const got: Float32Array[] = []
    const seg = new Segmenter((a) => got.push(a))
    feed(seg, silence(1))
    feed(seg, toPcm(synthVoice(WEARER, { seed: 1, seconds: 2 })))
    feed(seg, silence(1.2))
    feed(seg, toPcm(synthVoice(WEARER, { seed: 2, seconds: 1.5 })))
    feed(seg, silence(1))
    expect(got).toHaveLength(2)
    expect(got[0]!.length / 16000).toBeGreaterThan(1.8)
    expect(got[0]!.length / 16000).toBeLessThan(2.8)
    expect(got[1]!.length / 16000).toBeGreaterThan(1.3)
  })

  it('drops blips shorter than 0.8 s, reports levels, and flush() closes an open utterance', () => {
    const got: Float32Array[] = []
    const levels: boolean[] = []
    const seg = new Segmenter((a) => got.push(a), (_db, speaking) => levels.push(speaking))
    feed(seg, silence(0.5))
    feed(seg, toPcm(synthVoice(WEARER, { seed: 3, seconds: 0.4 })))
    feed(seg, silence(1))
    expect(got).toHaveLength(0)
    feed(seg, toPcm(synthVoice(WEARER, { seed: 4, seconds: 2 })))
    expect(levels).toContain(true)
    seg.flush()
    expect(got).toHaveLength(1)
  })

  it('a steady hum does not become speech once the floor has settled', () => {
    const got: Float32Array[] = []
    const seg = new Segmenter((a) => got.push(a))
    const hum = new Float32Array(16000 * 3).map((_, i) => 0.002 * Math.sin(i / 7))
    feed(seg, toPcm(hum))
    seg.flush()
    expect(got).toHaveLength(0)
  })
})

describe('Enrollment', () => {
  it('ships a balanced set of English and Japanese prompts, with pronunciation for Japanese', () => {
    expect(PROMPTS.filter((p) => p.lang === 'en').length).toBeGreaterThanOrEqual(3)
    expect(PROMPTS.filter((p) => p.lang === 'ja').length).toBeGreaterThanOrEqual(3)
    for (const p of PROMPTS.filter((p) => p.lang === 'ja')) {
      expect(p.romaji).toMatch(/^[\x20-\x7e]+$/)
      expect(p.meaning).toBeTruthy()
    }
  })

  const prompts: Prompt[] = [
    { lang: 'en', text: 'a' },
    { lang: 'en', text: 'b' },
    { lang: 'ja', text: 'c' },
    { lang: 'ja', text: 'd' },
  ]

  it('advances on good audio, rejects unclear and quiet audio without advancing', () => {
    const e = new Enrollment(prompts)
    expect(e.submit(new Float32Array(16000))).toEqual({ ok: false, reason: 'unclear' })
    expect(e.submit(synthVoice(WEARER, { seed: 1, levelDb: -62 }))).toMatchObject({ ok: false })
    expect(e.index).toBe(0)
    expect(e.submit(synthVoice(WEARER, { seed: 1, seconds: 3 }))).toMatchObject({ ok: true })
    expect(e.index).toBe(1)
  })

  it('builds a ready, good-quality profile from all prompts, with each language filed under its own', () => {
    const e = new Enrollment(prompts)
    for (let i = 1; !e.done; i++) expect(e.submit(synthVoice(WEARER, { seed: i, seconds: 3 }))).toMatchObject({ ok: true })
    const r = e.result()
    expect(r.ready).toBe(true)
    expect(r.profile.en.seed).toHaveLength(2)
    expect(r.profile.ja.seed).toHaveLength(2)
  })

  it('skipping leaves a gap but the profile is not ready until enough samples exist', () => {
    const e = new Enrollment(prompts)
    e.submit(synthVoice(WEARER, { seed: 1, seconds: 3 }))
    e.skip()
    e.skip()
    e.skip()
    expect(e.done).toBe(true)
    expect(e.result().ready).toBe(false)
    expect(e.result().quality.label).toBe('weak')
  })
})
