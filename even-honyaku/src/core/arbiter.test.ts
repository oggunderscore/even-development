import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Arbiter } from './arbiter'

describe('Arbiter (ja + en models on the same audio)', () => {
  let out: [string, string][]
  let a: Arbiter
  beforeEach(() => {
    vi.useFakeTimers()
    out = []
    a = new Arbiter((text, dir) => out.push([text, dir]))
  })
  afterEach(() => {
    a.dispose()
    vi.useRealTimers()
  })

  it('Japanese is emitted immediately', () => {
    a.ja({ text: 'これはいくらですか。', confidence: 0.95, start: 0, end: 2.5 })
    expect(out).toEqual([['これはいくらですか。', 'listen']])
  })

  it('English text from the en model for Japanese speech is dropped, even if it arrives first', () => {
    a.en({ text: 'cora wha ikura des ka', confidence: 0.8, start: 0, end: 2.4 })
    vi.advanceTimersByTime(300)
    a.ja({ text: 'これはいくらですか。', confidence: 0.9, start: 0, end: 2.5 })
    vi.advanceTimersByTime(2000)
    expect(out).toEqual([['これはいくらですか。', 'listen']])
  })

  it('English text arriving after the Japanese claim is dropped too', () => {
    a.ja({ text: 'ありがとう', confidence: 0.9, start: 5, end: 6.5 })
    a.en({ text: 'Arigato', confidence: 0.9, start: 5.1, end: 6.4 })
    vi.advanceTimersByTime(2000)
    expect(out).toEqual([['ありがとう', 'listen']])
  })

  it('real English is emitted after the grace period when the ja model heard nothing usable', () => {
    a.en({ text: 'How much is this?', confidence: 0.98, start: 10, end: 12 })
    expect(out).toEqual([])
    vi.advanceTimersByTime(800)
    expect(out).toEqual([['How much is this?', 'speak']])
  })

  it('ja-model output without Japanese script (or very low confidence) does not claim the audio', () => {
    a.ja({ text: 'How much is this', confidence: 0.9, start: 10, end: 12 })
    a.ja({ text: 'あ', confidence: 0.1, start: 10, end: 12 })
    a.en({ text: 'How much is this?', confidence: 0.98, start: 10, end: 12 })
    vi.advanceTimersByTime(800)
    expect(out).toEqual([['How much is this?', 'speak']])
  })

  it('back-to-back utterances (ranges that merely touch) do not claim each other', () => {
    a.ja({ text: 'すみません、駅はどこですか。', confidence: 1, start: 0, end: 2.6 })
    a.en({ text: 'Excuse me. Where is the train station?', confidence: 1, start: 2.6, end: 6.5 })
    vi.advanceTimersByTime(800)
    expect(out).toEqual([
      ['すみません、駅はどこですか。', 'listen'],
      ['Excuse me. Where is the train station?', 'speak'],
    ])
  })

  it('separate utterances do not interfere', () => {
    a.ja({ text: 'こんにちは', confidence: 0.9, start: 0, end: 1 })
    a.en({ text: 'Where is the station?', confidence: 0.95, start: 4, end: 6 })
    vi.advanceTimersByTime(800)
    expect(out).toEqual([
      ['こんにちは', 'listen'],
      ['Where is the station?', 'speak'],
    ])
  })

  it('drops low-confidence English', () => {
    a.en({ text: 'uh', confidence: 0.3, start: 0, end: 0.5 })
    vi.advanceTimersByTime(2000)
    expect(out).toEqual([])
  })

  it('flush() resolves held English immediately', () => {
    a.en({ text: 'Thank you', confidence: 0.95, start: 0, end: 1 })
    a.flush()
    expect(out).toEqual([['Thank you', 'speak']])
    vi.advanceTimersByTime(2000)
    expect(out).toHaveLength(1)
  })
})
