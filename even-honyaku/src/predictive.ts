// Predictive Conversation Mode, glasses side (pure logic, no SDK): what the body of the page shows.
//
// The screen is one conversation turn at a time: what the other person just said, in English, and underneath it the
// replies the wearer can read aloud — a single reply for a statement, a few different ones for a decision. Earlier
// turns scroll away on their own (they stay reachable by swiping up past the first option). Rows are laid out against
// the real row budget so nothing is ever clipped or re-wrapped by the glasses.

import { NEW_TURN_AFTER_MS } from './core/turns'
import { wrapLine } from './feed'
import type { Prediction, Translation } from './protocol'

/** Rows in the predictive body (256 px of text at ~28 px a line). */
export const BODY_ROWS = 9
const HISTORY = 20

interface Line {
  english: string
  japanese: string
  romaji: string
}

interface Turn {
  /** What the other person said this turn (one entry per recognised phrase). */
  lines: Line[]
  /** Id of the last phrase; predictions are matched to it. */
  lastId: number
  /** When the last phrase arrived (ms), to tell a continuation from a fresh turn. */
  at: number
  /** At least one phrase of this turn was attributed to the other person with confidence. */
  confident: boolean
  unsure: boolean
  live: string
  thinking: boolean
  prediction: Prediction | null
  /** Option the wearer picked or was heard reading aloud. */
  said: number | null
  /** The wearer answered in free English instead: their romaji. */
  free: { english: string; romaji: string; japanese: string } | null
  error: string | null
}

const newTurn = (): Turn => ({ lines: [], lastId: -1, at: 0, confident: false, unsure: false, live: '', thinking: false, prediction: null, said: null, free: null, error: null })

export interface PredictiveOptions {
  /** Draw kana/kanji too (the user turned it on; the font support is unverified, so off by default). */
  kana: boolean
}

/** Cut text to at most `rows` wrapped rows, ending in ".." when something was dropped. */
function clampRows(text: string, rows: number): string[] {
  const all = wrapLine(text)
  if (all.length <= rows) return all
  const kept = all.slice(0, rows)
  kept[rows - 1] = `${kept[rows - 1]!.replace(/\s+\S*$/, '').trimEnd()}..`
  return kept
}

export class PredictiveView {
  private turns: Turn[] = []
  /** Index into `turns` being looked at; null = the live (newest) turn. */
  private viewing: number | null = null
  private cursor = 0
  /** Suggestions that arrived before the translation they answer (a slow or failed translation). */
  private early: { turnId: number; prediction: Prediction } | null = null

  constructor(private opts: PredictiveOptions = { kana: false }) {}

  setKana(kana: boolean) {
    this.opts = { ...this.opts, kana }
  }

  private get live(): Turn | undefined {
    return this.turns.at(-1)
  }
  private get shown(): Turn | undefined {
    return this.viewing === null ? this.live : this.turns[this.viewing]
  }

  /** True when the live turn is done being answered, so the next thing the other person says starts a new one. */
  private get closed(): boolean {
    const t = this.live
    return !t || t.said !== null || t.free !== null
  }

  get hasContent(): boolean {
    return this.turns.length > 0
  }
  get isLive(): boolean {
    return this.viewing === null
  }

  private startTurn(): Turn {
    const t = newTurn()
    this.turns.push(t)
    if (this.turns.length > HISTORY) this.turns.shift()
    this.viewing = null
    this.cursor = 0
    return t
  }

  // ── events from the engine ──────────────────────────────────────────────────

  /** Interim transcript of the other person; an empty string clears it. */
  hearing(text: string) {
    if (!text) {
      const t = this.live
      if (t && !t.lines.length && !t.free && !t.prediction) this.turns.pop() // it was only an interim phrase that never became a turn
      else if (t) t.live = ''
      return
    }
    const t = this.closed ? this.startTurn() : this.live!
    t.live = text
  }

  /** A finished translation. */
  heard(tr: Translation, predictionExpected: boolean, now = Date.now()) {
    if (tr.dir === 'speak') {
      // The wearer answered in their own words: show their romaji until the other person speaks again.
      const t = this.live ?? this.startTurn()
      t.live = ''
      t.thinking = false
      t.free = { english: tr.english, romaji: tr.romaji, japanese: tr.japanese }
      this.viewing = null
      return
    }
    const stale = this.live !== undefined && this.live.lines.length > 0 && now - this.live.at > NEW_TURN_AFTER_MS
    const t = this.closed || stale ? this.startTurn() : this.live!
    t.live = ''
    t.at = now
    t.lines.push({ english: tr.heardEnglish ? tr.english : tr.english || tr.romaji, japanese: tr.japanese, romaji: tr.romaji })
    t.lines = t.lines.slice(-3)
    // A phrase we're unsure about is shown but never asked about, so it must not disturb a turn that is already
    // waiting for (or showing) suggestions to a confident phrase.
    if (!tr.unsure) {
      t.confident = true
      t.unsure = false
      t.lastId = tr.id
      t.thinking = predictionExpected
    } else if (!t.confident) {
      t.unsure = true
      t.lastId = tr.id
      t.thinking = false
    }
    t.error = null
    this.viewing = null
    if (this.early && this.early.turnId <= tr.id) {
      const e = this.early
      this.early = null
      if (e.turnId === tr.id) this.predictions(e.turnId, e.prediction)
    }
  }

  /** Suggested replies arrived. Ignored if the other person has already moved on to another turn. */
  predictions(turnId: number, prediction: Prediction) {
    const live = this.live
    let t = this.turns.find((x) => x.lastId === turnId)
    if (!t) {
      // Newer than anything shown: the translation it answers hasn't arrived (or failed). Attach to the open turn, or
      // hold it for the translation. Older than the live turn means it's stale and is dropped.
      if (live && live.said === null && live.free === null && !live.prediction && turnId > live.lastId && live.lines.length) {
        live.lastId = turnId
        t = live
      } else {
        if (!live || live.said !== null || live.free !== null) this.early = { turnId, prediction }
        return
      }
    }
    if (t.said !== null || t.free !== null) return
    t.prediction = prediction
    t.thinking = false
    if (t === this.live) {
      this.cursor = 0
    }
  }

  failed(message: string) {
    const t = this.live
    if (t) {
      t.thinking = false
      t.error = message
    }
  }

  /** The wearer read one of the options aloud (or picked it): mark it and let the turn rest. `turnId` says whose options. */
  said(index: number, turnId?: number): boolean {
    const t = this.live
    if (!t?.prediction || index < 0 || index >= t.prediction.options.length) return false
    if (turnId !== undefined && t.lastId !== turnId) return false // that was an answer to an earlier question
    t.said = index
    t.thinking = false
    this.cursor = index
    return true
  }

  /** The wearer said something else in Japanese that the voice filter dropped: the turn is theirs now. */
  selfSpoke() {
    const t = this.live
    if (!t) return
    if (!t.lines.length && !t.free && !t.prediction) {
      this.turns.pop() // an interim phrase that turned out to be the wearer talking
      return
    }
    if (t.said === null && t.free === null) {
      t.thinking = false
      t.said = -1
    }
  }

  // ── gestures ────────────────────────────────────────────────────────────────

  /** Swipe. Returns whether the screen changed. */
  move(dir: 'up' | 'down'): boolean {
    const t = this.shown
    if (!t) return false
    const options = t.prediction?.options.length ?? 0

    if (this.viewing !== null) {
      // reading an earlier turn: up = older, down = newer, past the newest = back to live
      if (dir === 'up') {
        if (this.viewing === 0) return false
        this.viewing--
      } else {
        const next = this.viewing + 1
        this.viewing = next >= this.turns.length - 1 ? null : next // the newest turn is the live view
        this.cursor = 0
      }
      return true
    }

    if (options > 0 && t.free === null) {
      if (dir === 'down') {
        if (this.cursor >= options - 1) return false
        this.cursor++
        return true
      }
      if (this.cursor > 0) {
        this.cursor--
        return true
      }
    }
    // top of the options (or nothing to pick): go back through earlier turns
    if (dir === 'up' && this.turns.length > 1) {
      this.viewing = this.turns.length - 2
      return true
    }
    return false
  }

  // ── rendering ───────────────────────────────────────────────────────────────

  /** The body text: at most BODY_ROWS rows. */
  rows(): string[] {
    const t = this.shown
    if (!t) return ['Waiting for them to speak.', 'Replies appear here.']

    const out: string[] = []
    const question = t.lines.length ? t.lines.map((l) => l.english).join(' ') : ''
    const qRows = question ? clampRows(`JP: ${question}${t.unsure ? ' (?)' : ''}`, 2) : []

    if (t.free) {
      // the wearer's own answer, as large as the font allows: just the words to read
      out.push(...qRows.slice(0, 1))
      out.push('', `you: ${t.free.english}`.slice(0, 60), ...wrapLine(t.free.romaji).slice(0, 4))
      if (this.opts.kana && t.free.japanese) out.push(...wrapLine(t.free.japanese).slice(0, 2))
      return out.slice(0, BODY_ROWS)
    }

    if (t.live && !qRows.length) qRows.push(...clampRows(`JP: ${t.live}...`, 2))
    const kanaRow = this.opts.kana && t.lines.length ? clampRows(t.lines.map((l) => l.japanese).join(' '), 1) : []
    out.push(...kanaRow, ...qRows)

    const options = t.prediction?.options ?? []
    if (!options.length) {
      if (t.error) out.push('', ...clampRows(`(no suggestions: ${t.error})`, 3))
      else if (t.thinking) out.push('', 'thinking...')
      return out.slice(0, BODY_ROWS)
    }

    if (t.thinking) out.push('...')
    const numbered = options.length > 1
    const budget = BODY_ROWS - out.length
    // Fit as many options as the budget allows, always keeping the highlighted one in view.
    const blocks = options.map((o, i) => {
      const mark = t.said === i ? '●' : this.viewing === null && this.cursor === i ? '▶' : ' '
      const head = `${mark}${numbered ? ` ${i + 1}` : ''} ${o.gloss}`
      return [...clampRows(head, 1), ...clampRows(`     ${o.romaji}`, 2)]
    })
    let first = 0
    const rowsFor = (from: number, to: number) => blocks.slice(from, to).reduce((n, b) => n + b.length, 0)
    let last = options.length
    while (rowsFor(first, last) > budget && last - first > 1) {
      if (this.cursor < last - 1) last--
      else first++
    }
    for (const b of blocks.slice(first, last)) out.push(...b)
    return out.slice(0, BODY_ROWS)
  }

  /** Short state for the header's hint area (the Display adds the tap and double-tap hints). */
  hint(): string {
    if (this.viewing !== null) return 'earlier: swipe down'
    const t = this.live
    if (t?.prediction && t.prediction.options.length > 1 && !t.free) return 'swipe: highlight'
    return ''
  }
}
