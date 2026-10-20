// Decides, per utterance, whether the speaker was talking Japanese or English when two dedicated
// Deepgram streams (a `ja` model and an `en` model) are fed the same audio.
//
// A single `language=multi` stream often starts a Japanese phrase as English text, which then gets
// translated English→English/Japanese. Dedicated models don't have that problem, but each one still
// produces output for the *other* language (usually junk), so we arbitrate — biased towards Japanese:
//
//   - a Japanese-model final that really contains kana/kanji is emitted at once and "claims" its time range;
//   - an English-model final is held for a short grace period and dropped if the Japanese model claimed
//     an overlapping range, so Japanese speech can never leak out as English text.

import type { Direction } from '../../src/protocol'
import { hasJapanese } from './lang'

export interface Heard {
  text: string
  /** 0..1 from Deepgram. */
  confidence: number
  /** Seconds from the start of the stream. Both streams get the same audio, so these line up. */
  start: number
  end: number
}

export interface ArbiterOptions {
  jaMinConfidence: number
  enMinConfidence: number
  /** How long an English final waits for a possible Japanese final covering the same audio. */
  graceMs: number
  /**
   * Two finals cover "the same speech" when they overlap by at least this fraction of the shorter one.
   * Deepgram ranges run from the previous final's end, so back-to-back utterances touch but must not match.
   */
  overlapFraction: number
}

export const DEFAULT_ARBITER: ArbiterOptions = { jaMinConfidence: 0.4, enMinConfidence: 0.55, graceMs: 700, overlapFraction: 0.5 }

interface Range {
  start: number
  end: number
}

export class Arbiter {
  private claimed: Range[] = []
  private pending: { heard: Heard; timer: ReturnType<typeof setTimeout> }[] = []

  constructor(
    private readonly emit: (text: string, dir: Direction, heard: Heard) => void,
    private readonly opts: ArbiterOptions = DEFAULT_ARBITER,
  ) {}

  /** A final from the Japanese model. */
  ja(h: Heard) {
    if (!hasJapanese(h.text) || h.confidence < this.opts.jaMinConfidence) return
    this.claimed.push({ start: h.start, end: h.end })
    if (this.claimed.length > 20) this.claimed.shift()
    // Any English guess for the same audio was the English model misreading Japanese.
    this.pending = this.pending.filter((p) => {
      if (!this.overlaps(p.heard, h)) return true
      clearTimeout(p.timer)
      return false
    })
    this.emit(h.text, 'listen', h)
  }

  /** A final from the English model. */
  en(h: Heard) {
    if (h.confidence < this.opts.enMinConfidence || this.isClaimed(h)) return
    const entry = {
      heard: h,
      timer: setTimeout(() => {
        this.pending = this.pending.filter((p) => p !== entry)
        if (!this.isClaimed(h)) this.emit(h.text, 'speak', h)
      }, this.opts.graceMs),
    }
    this.pending.push(entry)
  }

  /** The stream is ending: resolve held English finals now instead of waiting out the grace period. */
  flush() {
    const held = this.pending
    this.pending = []
    for (const p of held) {
      clearTimeout(p.timer)
      if (!this.isClaimed(p.heard)) this.emit(p.heard.text, 'speak', p.heard)
    }
  }

  dispose() {
    for (const p of this.pending) clearTimeout(p.timer)
    this.pending = []
  }

  private isClaimed(h: Range) {
    return this.claimed.some((c) => this.overlaps(h, c))
  }

  private overlaps(a: Range, b: Range) {
    const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start)
    const shorter = Math.min(a.end - a.start, b.end - b.start)
    return overlap > 0.2 && overlap >= shorter * this.opts.overlapFraction
  }
}
