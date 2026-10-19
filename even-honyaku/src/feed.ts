// The glasses feed as a window over a list of text rows (pure logic, no SDK).
//
// Content is laid out from the top of the body. New translations are appended below the existing rows (the
// "bottom"); once they overflow the window the view follows them, so the newest row is always the last visible one.
// Swiping scrolls row by row: up pushes rows off the top (past the last row the view is empty, every earlier
// translation hidden), down brings earlier rows back. New rows that arrive while the view is empty appear on their own.

/** Rows that fit in the body container (216 px at ~28 px a line). */
export const VIEW_ROWS = 7

/** Usable width of the body in pixels (576 minus padding), kept a little under so the glasses never re-wrap a row. */
const ROW_PX = 552
const MAX_ROWS = 240

/** Rough advance widths of the G2 font; unknown glyphs count as an average lower-case letter. */
function glyphPx(ch: string): number {
  if ('il.,:;\'!|jtfI '.includes(ch)) return 6
  if ('mwMW@'.includes(ch)) return 17
  if (ch >= 'A' && ch <= 'Z') return 13.5
  return 11.5
}

/** Word-wrap one logical line into rows no wider than ROW_PX. Over-long words are split. */
export function wrapLine(line: string): string[] {
  const rows: string[] = []
  let row = ''
  let width = 0
  const flush = () => {
    if (row.trim()) rows.push(row.trimEnd())
    row = ''
    width = 0
  }
  for (const word of line.split(/(?<= )/)) {
    const w = [...word].reduce((n, ch) => n + glyphPx(ch), 0)
    if (w > ROW_PX) {
      // a single word wider than a row: start a fresh row and hard-split it
      flush()
      for (const ch of word) {
        if (width + glyphPx(ch) > ROW_PX) flush()
        row += ch
        width += glyphPx(ch)
      }
      continue
    }
    if (width + w > ROW_PX) flush()
    row += word
    width += w
  }
  flush()
  return rows.length ? rows : ['']
}

export const wrapText = (text: string): string[] => text.split('\n').flatMap(wrapLine)

export class Feed {
  /** Finished entries (a translation pair or a note), each already wrapped into rows. */
  private entries: string[][] = []
  private live: string[] = []
  /** Floor for the first visible row. 0 normally; larger after the wearer scrolled earlier rows away. */
  private top = 0
  /** Following the newest rows (true), or reading history (false: `top` is exact). */
  private follow = true

  private get all(): string[] {
    return [...this.entries.flat(), ...this.live]
  }

  get length(): number {
    return this.entries.reduce((n, e) => n + e.length, 0) + this.live.length
  }

  /** Row index where each entry begins (the in-progress phrase counts as one). Scrolling snaps to these. */
  private get boundaries(): number[] {
    const out: number[] = []
    let at = 0
    for (const e of this.entries) {
      out.push(at)
      at += e.length
    }
    if (this.live.length) out.push(at)
    return out
  }

  /** First row of the view where the newest rows would sit at the bottom. */
  private get followStart(): number {
    return Math.max(0, this.length - VIEW_ROWS)
  }

  private get start(): number {
    return this.follow ? Math.max(this.top, this.followStart) : this.top
  }

  /** The rows on screen, top to bottom. Empty when everything has been scrolled away. */
  visible(): string[] {
    return this.all.slice(this.start, this.start + VIEW_ROWS)
  }

  /** Everything is scrolled away (and there is something to scroll away). */
  get cleared(): boolean {
    return this.length > 0 && this.start >= this.length
  }

  /** Append a finished entry (a translation or a note). */
  add(text: string) {
    const wasFollowing = this.follow
    this.live = []
    this.entries.push(wrapText(text))
    let total = this.length
    while (total > MAX_ROWS && this.entries.length > 1) {
      const dropped = this.entries.shift()!.length
      total -= dropped
      this.top = Math.max(0, this.top - dropped)
    }
    if (!wasFollowing) {
      // reading history: a new translation brings the view back to the newest rows
      this.follow = true
      this.top = 0
    }
  }

  /** The in-progress phrase; shown below the finished rows and replaced on every update. */
  setLive(text: string) {
    this.live = text ? wrapText(text) : []
  }

  /**
   * One swipe moves a whole entry (the "JP/you" line and its translation together). 'up' pushes the top entry
   * off the screen; 'down' brings the previous one back. Returns whether anything moved.
   */
  scroll(dir: 'up' | 'down'): boolean {
    const before = this.start
    const bounds = this.boundaries
    const next =
      dir === 'up'
        ? (bounds.find((b) => b > before) ?? this.length)
        : ([...bounds].reverse().find((b) => b < before) ?? 0)
    if (next === before) return false
    this.top = next
    this.follow = next >= this.followStart
    return true
  }
}
