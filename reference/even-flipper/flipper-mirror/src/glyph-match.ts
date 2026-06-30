/**
 * Glyph matcher: recover text from a Flipper 128x64 1bpp framebuffer by
 * template-matching against the device's own bitmap fonts (font-data.ts).
 *
 * This is deterministic template matching, not OCR: the glyph bitmaps are
 * exactly what the firmware draws, so for clean menu/list text it recovers the
 * real characters. It is best-effort - graphically dense or custom-drawn
 * screens won't parse well, and the caller is expected to fall back to image
 * mode for those (low confidence).
 *
 * Approach: normalize inverted (highlighted) selection bars, split into text
 * lines by blank-row gaps, then for each line search a small baseline range and
 * greedily match glyphs left-to-right, advancing by each glyph's advance width.
 * Both the primary (helvB08) and secondary (haxrcorp4089) GUI fonts are tried
 * per line; the higher-scoring one wins.
 */

import { FONTS, type BdfFont, type Glyph } from './font-data.ts'

export const W = 128
export const H = 64

// The Flipper draws a scrollbar in the rightmost ~3px on scrollable screens.
// Menu/list text always leaves a right margin, so we blank these columns to
// stop the scrollbar track/thumb from being matched as a spurious line.
const RIGHT_CROP = 5

export interface MatchedLine {
  text: string
  top: number
  bottom: number
  highlighted: boolean
  font: string
  score: number
  nchars: number
}
export interface FrameMatch {
  lines: MatchedLine[]
  confidence: number // 0..1, mean per-glyph score normalized; for image-fallback decisions
}

// Fonts to try per line, in preference order. Secondary first - it's the most
// common menu/list font.
const FONTS_TRY = ['haxrcorp4089', 'helvB08']

// Tunables.
const INVERT_FILL = 0.5 // row fill fraction above which a row is "highlighted"
const INVERT_MIN_ROWS = 4 // min band height to treat as a selection bar
const MIN_LINE_ROWS = 2 // ignore separators/noise thinner than this
const COVERAGE_MIN = 0.72 // glyph on-pixels that must be matched to accept
const ACCEPT_SCORE = 1.0 // min glyph score to emit a character

/** Unpack the 1bpp frame (row-major, MSB-first) into a W*H grid of 0/1. */
export function frameToGrid(frame: Uint8Array): Uint8Array {
  const g = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const rb = y * (W / 8)
    for (let x = 0; x < W; x++) {
      g[y * W + x] = (frame[rb + (x >> 3)] >> (7 - (x & 7))) & 1
    }
  }
  return g
}

function rowFill(g: Uint8Array, y: number): number {
  let n = 0
  for (let x = 0; x < W; x++) n += g[y * W + x]
  return n / W
}

/**
 * Detect near-full rows (Flipper highlight bars) and invert those bands in
 * place so the white-on-black selected text becomes matchable. Returns the
 * inverted band ranges so the caller can flag which line is selected.
 */
function normalizeInversion(g: Uint8Array): Array<{ t: number; b: number }> {
  const bands: Array<{ t: number; b: number }> = []
  let s = -1
  for (let y = 0; y <= H; y++) {
    const hi = y < H && rowFill(g, y) > INVERT_FILL
    if (hi && s < 0) s = y
    else if (!hi && s >= 0) {
      if (y - s >= INVERT_MIN_ROWS) bands.push({ t: s, b: y - 1 })
      s = -1
    }
  }
  for (const bd of bands) {
    for (let y = bd.t; y <= bd.b; y++) for (let x = 0; x < W; x++) g[y * W + x] ^= 1
  }
  return bands
}

// Longest ink run (px) that can still be part of a glyph. Anything longer is a
// rule/border/scrollbar. Tallest glyph ~10px, widest ~12px; add slack.
const MAX_GLYPH_RUN_V = 13
const MAX_GLYPH_RUN_H = 16

/**
 * Strip frame lines: clear any vertical or horizontal ink run longer than a
 * glyph could be. Removes selection-box borders (e.g. the main-menu rounded
 * frame), list separators, underlines and the right-edge scrollbar - all of
 * which otherwise merge with the text into one tall band and derail line
 * detection. Runs AFTER inversion so a filled selection bar (already turned
 * into normal text) is not mistaken for a rule.
 */
function removeRules(g: Uint8Array): number[] {
  // Rows where a wide horizontal run was cleared - i.e. box borders / separators.
  // Used to find which text line sits inside a selection box (main menu).
  const ruleRows: number[] = []
  // vertical runs
  for (let x = 0; x < W; x++) {
    let run = 0
    let start = 0
    for (let y = 0; y <= H; y++) {
      const on = y < H && g[y * W + x] === 1
      if (on) {
        if (run === 0) start = y
        run++
      } else {
        if (run > MAX_GLYPH_RUN_V) for (let yy = start; yy < start + run; yy++) g[yy * W + x] = 0
        run = 0
      }
    }
  }
  // horizontal runs
  for (let y = 0; y < H; y++) {
    let run = 0
    let start = 0
    for (let x = 0; x <= W; x++) {
      const on = x < W && g[y * W + x] === 1
      if (on) {
        if (run === 0) start = x
        run++
      } else {
        if (run > MAX_GLYPH_RUN_H) {
          for (let xx = start; xx < start + run; xx++) g[y * W + xx] = 0
          if (run >= 50) ruleRows.push(y) // wide enough to be a box border / separator
        }
        run = 0
      }
    }
  }
  return ruleRows
}

/** Split into text lines by runs of non-empty rows. */
function detectLines(g: Uint8Array): Array<{ t: number; b: number }> {
  const lines: Array<{ t: number; b: number }> = []
  let s = -1
  for (let y = 0; y <= H; y++) {
    let any = false
    if (y < H) {
      for (let x = 0; x < W; x++) {
        if (g[y * W + x]) {
          any = true
          break
        }
      }
    }
    if (any && s < 0) s = y
    else if (!any && s >= 0) {
      if (y - s >= MIN_LINE_ROWS) lines.push({ t: s, b: y - 1 })
      s = -1
    }
  }
  return lines
}

function gbit(gl: Glyph, gr: number, c: number): number {
  return (gl.rows[gr] >> (gl.rowBits - 1 - c)) & 1
}

/**
 * Resolve the inherent 'I'/'l' glyph ambiguity by context: a capital 'I'
 * following a lowercase letter is really a lowercase 'l' (mid-word). Keeps
 * 'I' at word starts ("Info") and in all-caps ("RFID"). Processed left-to-right
 * so consecutive ambiguous strokes chain ("ManuaIIy" -> "Manually").
 */
function fixIl(s: string): string {
  const a = [...s]
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 'I') continue
    const prev = i > 0 ? a[i - 1] : ''
    const next = i + 1 < a.length ? a[i + 1] : ''
    const prevLc = /[a-z]/.test(prev)
    const prevUc = /[A-Z]/.test(prev)
    const nextLc = /[a-z]/.test(next)
    // lowercase-then-I (mid/end of word) -> l; or upper-I-lower ("Fl") -> l.
    // Word-start 'I' before lowercase ("Info") has no letter before it -> kept.
    if (prevLc || (prevUc && nextLc)) a[i] = 'l'
  }
  return a.join('')
}

/** Leftmost / rightmost inked column of a glyph (cached on the object). */
function inkBounds(gl: Glyph): { lo: number; hi: number } {
  const g = gl as Glyph & { _lo?: number; _hi?: number }
  if (g._lo !== undefined) return { lo: g._lo, hi: g._hi! }
  let lo = gl.w
  let hi = -1
  for (let gr = 0; gr < gl.h; gr++) {
    for (let c = 0; c < gl.w; c++) {
      if (gbit(gl, gr, c)) {
        if (c < lo) lo = c
        if (c > hi) hi = c
      }
    }
  }
  if (hi < 0) {
    lo = 0
    hi = -1
  }
  g._lo = lo
  g._hi = hi
  return { lo, hi }
}

/** Is there any ink in column x within the font's vertical band around baseline B? */
function columnInk(g: Uint8Array, x: number, B: number, font: BdfFont): boolean {
  const t = Math.max(0, B - font.ascent - 1)
  const b = Math.min(H - 1, B + font.descent)
  for (let y = t; y <= b; y++) if (g[y * W + x]) return true
  return false
}

/**
 * Score placing glyph gl with bitmap left column at `left`, baseline B.
 * Stray ink is counted over the FULL text band (bandTop..bandBot) within the
 * glyph's columns, not just its bbox - so a tiny glyph (period, quote) placed
 * over a tall digit is penalized for all the unexplained ink above it, which
 * stops small glyphs from matching big ones.
 */
function scoreGlyph(
  g: Uint8Array,
  gl: Glyph,
  left: number,
  B: number,
  bandTop: number,
  bandBot: number,
): { score: number; on: number; onMatch: number } {
  const top = B - gl.yo - gl.h // screen row of glyph row 0
  let on = 0
  let onMatch = 0
  let score = 0
  for (let c = 0; c < gl.w; c++) {
    const x = left + c
    if (x < 0 || x >= W) {
      // off-screen: glyph ink here can't match -> miss
      for (let gr = 0; gr < gl.h; gr++) if (gbit(gl, gr, c)) { on++; score -= 2 }
      continue
    }
    // glyph on-pixels: match vs miss
    for (let gr = 0; gr < gl.h; gr++) {
      if (!gbit(gl, gr, c)) continue
      on++
      const y = top + gr
      if (y >= 0 && y < H && g[y * W + x]) {
        onMatch++
        score += 1
      } else score -= 2
    }
    // unexplained frame ink in this column across the whole band -> stray
    for (let y = bandTop; y <= bandBot; y++) {
      if (!g[y * W + x]) continue
      const gr = y - top
      const explained = gr >= 0 && gr < gl.h && gbit(gl, gr, c)
      if (!explained) score -= 1
    }
  }
  return { score, on, onMatch }
}

/** Greedy left-to-right match of one line at baseline B with one font. */
function greedy(
  g: Uint8Array,
  B: number,
  font: BdfFont,
): { text: string; score: number; nchars: number } {
  const glyphs = font.glyphs
  const codes = Object.keys(glyphs)
  const spaceGap = Math.max(2, Math.round(font.bbw * 0.3))
  const bandTop = Math.max(0, B - font.ascent - 1)
  const bandBot = Math.min(H - 1, B + font.descent)
  let x = 0
  let text = ''
  let score = 0
  let nchars = 0
  while (x < W) {
    if (!columnInk(g, x, B, font)) {
      let gap = 0
      while (x + gap < W && !columnInk(g, x + gap, B, font)) gap++
      if (text.length > 0 && gap >= spaceGap) text += ' '
      x += Math.max(gap, 1)
      continue
    }
    // x is the first inked column. Align each glyph so its leftmost ink lands
    // on x (with +/-1 jitter), rather than pinning the bitmap origin there -
    // critical for proportional fonts so a wide glyph can't be mis-fit over a
    // narrow one.
    // Select by score EFFICIENCY (score per glyph on-pixel), not raw total:
    // absolute-pixel greedy structurally prefers a wide glyph that overlaps the
    // next character (e.g. 'm' fitting over 'l','i'). Efficiency rewards the
    // glyph that cleanly explains the ink at x. Gate on coverage + min ink so a
    // tiny glyph can't win on a single stroke; tie-break toward more pixels.
    let bestEff = -1e9
    let bestRaw = 0
    let bestOn = 0
    let bestGl: Glyph | null = null
    let bestCode = -1
    let bestLeft = x
    for (const code of codes) {
      if (code === '32') continue // space has no bitmap
      const gl = glyphs[code as unknown as number]
      const { lo, hi } = inkBounds(gl)
      if (hi < 0) continue
      // Align the glyph's leftmost ink onto x (the first inked column).
      const left = x - lo
      const r = scoreGlyph(g, gl, left, B, bandTop, bandBot)
      if (r.on < 1) continue
      if (r.onMatch / r.on < COVERAGE_MIN) continue
      if (r.score < ACCEPT_SCORE) continue
      const eff = r.score / r.on
      if (eff > bestEff + 1e-6 || (Math.abs(eff - bestEff) <= 1e-6 && r.on > bestOn)) {
        bestEff = eff
        bestRaw = r.score
        bestOn = r.on
        bestGl = gl
        bestCode = +code
        bestLeft = left
      }
    }
    if (bestGl) {
      text += String.fromCharCode(bestCode)
      score += bestRaw
      nchars++
      const { hi } = inkBounds(bestGl)
      // Advance past this glyph's ink, then the loop re-skips to the next ink
      // (self-correcting; also lets the gap logic see real inter-word spaces).
      x = Math.max(x + 1, bestLeft + hi + 1)
    } else {
      x++ // unmatched ink (icon/graphic) - skip
    }
  }
  return { text: text.replace(/\s+$/, ''), score, nchars }
}

function matchLineFont(
  g: Uint8Array,
  line: { t: number; b: number },
  fontName: string,
): { text: string; score: number; nchars: number } {
  const font = FONTS[fontName]
  // Search the baseline across the WHOLE band, not just near its bottom: a band
  // can be taller than its text (e.g. a menu item whose left icon extends above
  // and below the label), so the text baseline isn't necessarily at the bottom.
  // The correct baseline scores highest (clean text beats icon noise).
  let best = { text: '', score: -1e9, nchars: 0 }
  for (let B = line.t + 4; B <= line.b + font.descent + 1; B++) {
    const r = greedy(g, B, font)
    if (r.nchars > 0 && r.score > best.score) best = r
  }
  return best
}

/** Recover text lines from a 1bpp 128x64 Flipper frame. */
export function matchFrame(frame: Uint8Array): FrameMatch {
  const g = frameToGrid(frame)
  // Blank the scrollbar margin so it can't become a spurious line.
  for (let y = 0; y < H; y++) for (let x = W - RIGHT_CROP; x < W; x++) g[y * W + x] = 0
  const invBands = normalizeInversion(g)
  const ruleRows = removeRules(g)
  const lines = detectLines(g)
  // A line is "selected" if it sits inside a box: a border rule just above its
  // top and another just below its bottom (the main-menu selection frame).
  const boxed = (t: number, b: number) =>
    ruleRows.some((r) => r >= t - 7 && r <= t + 2) && ruleRows.some((r) => r >= b - 2 && r <= b + 7)
  const out: MatchedLine[] = []
  let totScore = 0
  let totChars = 0
  for (const ln of lines) {
    let best = { text: '', score: -1e9, nchars: 0, font: '' }
    for (const f of FONTS_TRY) {
      const r = matchLineFont(g, ln, f)
      if (r.text.trim() && r.score > best.score) best = { ...r, font: f }
    }
    if (!best.text.trim()) continue
    // Strip leading icon noise: menu items have a left icon that matches as
    // junk punctuation (, ' | " *). Conservative set - excludes - + . digits so
    // real leading values (e.g. "-67 dBm") survive.
    const cleaned = fixIl(best.text.replace(/^[\s,'`|"*~^]+/, ''))
    const highlighted =
      invBands.some((bd) => !(ln.b < bd.t || ln.t > bd.b)) || boxed(ln.t, ln.b)
    out.push({
      text: cleaned || best.text,
      top: ln.t,
      bottom: ln.b,
      highlighted,
      font: best.font,
      score: best.score,
      nchars: best.nchars,
    })
    totScore += best.score
    totChars += best.nchars
  }
  // Confidence: mean per-glyph score, mapped to ~0..1 (a clean glyph scores
  // roughly its on-pixel count; we normalize by a typical glyph mass).
  const confidence = totChars > 0 ? Math.min(1, totScore / totChars / 12) : 0
  return { lines: out, confidence }
}

/**
 * Render a string into a 128x64 frame with one of the fonts (for offline tests
 * only). Mirrors the matcher's geometry so a render->match round-trip exercises
 * the matching logic. Not used at runtime.
 */
export function renderTextToFrame(
  rows: Array<{ text: string; font: string; x?: number; baseline: number }>,
): Uint8Array {
  const g = new Uint8Array(W * H)
  for (const r of rows) {
    const font = FONTS[r.font]
    let pen = r.x ?? 0
    for (const ch of r.text) {
      const code = ch.charCodeAt(0)
      const gl = font.glyphs[code]
      if (!gl) {
        pen += Math.round(font.bbw * 0.5)
        continue
      }
      const top = r.baseline - gl.yo - gl.h
      for (let gr = 0; gr < gl.h; gr++) {
        const y = top + gr
        if (y < 0 || y >= H) continue
        for (let c = 0; c < gl.w; c++) {
          const x = pen + gl.xo + c
          if (x < 0 || x >= W) continue
          if (gbit(gl, gr, c)) g[y * W + x] = 1
        }
      }
      pen += gl.dw
    }
  }
  // pack back to 1bpp row-major
  const out = new Uint8Array((W * H) / 8)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y * W + x]) out[y * (W / 8) + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}
