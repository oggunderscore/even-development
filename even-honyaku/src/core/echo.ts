// L0 of the voice filter: "the wearer is reading one of the replies we just suggested".
//
// The most common way the wearer's Japanese reaches the microphone is reading a suggested romaji reply aloud. We know
// exactly what we put on their glasses, so a transcript that matches it is almost certainly them — no audio model
// needed. The Japanese model usually writes kana/kanji (compared against the reply's Japanese and its romaji); when the
// wearer's accent confuses it, the English model may write the sounds in English spelling; when that comes out close
// ("hi onegai shi mas") it is compared too, a little more strictly. Heavily garbled English can't be matched by text
// and is left to the level and voiceprint signals.

import { toRomaji } from 'wanakana'
import type { ReplyOption } from '../protocol'

/** Suggestions older than this can't be what the wearer is reading now. */
const FRESH_MS = 120_000
const KEEP_SETS = 4

/** Letters (kana become romaji) and kanji only: no spaces, punctuation or case, so "Hai, onegaishimasu." == "はいおねがいします". */
export function loose(text: string): string {
  return toRomaji(text.normalize('NFKC').toLowerCase())
    .replace(/ー/g, '')
    .replace(/[^a-z㐀-鿿]/g, '')
}

const bigrams = (s: string) => {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
  return m
}

/** 0..1 — Dice coefficient over letter pairs, plus a floor when one text contains the other. */
export function similarity(a: string, b: string): number {
  const x = loose(a)
  const y = loose(b)
  if (x.length < 3 || y.length < 3) return x.length >= 2 && x === y ? 1 : 0
  if (x === y) return 1
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const contained = short.length >= 5 && long.includes(short) ? 0.85 : 0
  const bx = bigrams(x)
  const by = bigrams(y)
  let shared = 0
  for (const [k, n] of bx) shared += Math.min(n, by.get(k) ?? 0)
  return Math.max(contained, (2 * shared) / (x.length - 1 + (y.length - 1)))
}

export interface EchoMatch {
  /** 0..1 */
  score: number
  turnId: number
  index: number
  option: ReplyOption
}

interface Remembered {
  turnId: number
  options: ReplyOption[]
  at: number
}

export class EchoMatcher {
  private sets: Remembered[] = []

  /** Remember the replies that were just offered for a turn. */
  remember(turnId: number, options: ReplyOption[], now = Date.now()) {
    this.sets = [...this.sets.filter((s) => s.turnId !== turnId), { turnId, options, at: now }].slice(-KEEP_SETS)
  }

  clear() {
    this.sets = []
  }

  /**
   * How closely `text` matches any fresh suggestion. `language` is what the recogniser thought it heard: English
   * transcripts of Japanese speech are noisier, so they count a little less.
   */
  match(text: string, language: 'ja' | 'en', now = Date.now()): EchoMatch | null {
    const factor = language === 'ja' ? 1 : 0.88
    let best: EchoMatch | null = null
    for (const set of this.sets) {
      if (now - set.at > FRESH_MS) continue
      set.options.forEach((option, index) => {
        const score = factor * Math.max(similarity(text, option.ja), similarity(text, option.romaji))
        if (score > (best?.score ?? 0)) best = { score, turnId: set.turnId, index, option }
      })
    }
    return best
  }
}
