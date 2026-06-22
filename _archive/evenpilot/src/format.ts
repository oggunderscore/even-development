import type { GridPos } from './layout'

export type SpeedUnit = 'mph' | 'kmh'

export interface GeoLocation {
  street: string
  city:   string
  state:  string
}

// ── Speed ─────────────────────────────────────────────────────────────────────

const COMPASS_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export function bearingToCompass(degrees: number): string {
  const idx = Math.round(((degrees % 360) + 360) % 360 / 45) % 8
  return COMPASS_DIRS[idx]
}

export function formatSpeed(mps: number | null, unit: SpeedUnit): string {
  if (mps == null || mps < 0) return `-- ${unit}`
  const val = unit === 'mph' ? mps * 2.23694 : mps * 3.6
  return `${Math.round(val)} ${unit}`
}

export function formatLimit(mph: number | null): string {
  return mph != null ? String(mph) : '--'
}

// ── Location — layout-aware ────────────────────────────────────────────────────
//
//  Column rules (mirrors how text aligns to the screen edge):
//    center  →  single flat line, city + state only (space-efficient)
//    left    →  two lines: street on top, city + state below
//    right   →  two lines: street on top, city + state below
//              (companion UI sets text-align:right so it reads from the edge)

type Column = 'left' | 'center' | 'right'

function columnOf(pos: GridPos): Column {
  if (pos === 'tl' || pos === 'ml' || pos === 'bl') return 'left'
  if (pos === 'tr' || pos === 'mr' || pos === 'br') return 'right'
  return 'center'
}

// Max chars for a street name on one line.
// Glasses container is 192px wide, 4px padding each side = 184px inner.
// LVGL font averages ~11px per character → floor(184/11) = 16 chars safe max.
const STREET_MAX = 16

// Shorten long road names so they always fit on a single line in a corner cell
function abbreviateStreet(street: string): string {
  const s = street
    .replace(/\bNorthbound\b/gi, 'NB').replace(/\bSouthbound\b/gi, 'SB')
    .replace(/\bEastbound\b/gi,  'EB').replace(/\bWestbound\b/gi,  'WB')
    .replace(/\bInterstate\s+(\d+)/gi,                    'I-$1')
    .replace(/\bUS(?:\s*-\s*|\s+)(?:Route\s+)?(\d+)/gi,  'US-$1')
    .replace(/\bState\s+(?:Route|Hwy|Highway)\s+(\d+)/gi, 'SR-$1')
    .replace(/\b(?:Highway|Hwy)\s+(\d+)/gi,               'Hwy $1')
    .replace(/\bCounty\s+(?:Road|Route)\s+/gi,            'CR ')
    .replace(/\bBoulevard\b/gi, 'Blvd').replace(/\bAvenue\b/gi,  'Ave')
    .replace(/\bDrive\b/gi,     'Dr'  ).replace(/\bStreet\b/gi,  'St')
    .replace(/\bRoad\b/gi,      'Rd'  ).replace(/\bLane\b/gi,    'Ln')
    .trim()
  // Hard cap: truncate at a word boundary where possible, otherwise at the char limit
  if (s.length <= STREET_MAX) return s
  const cut = s.slice(0, STREET_MAX).lastIndexOf(' ')
  return (cut > STREET_MAX / 2 ? s.slice(0, cut) : s.slice(0, STREET_MAX)).trimEnd()
}

export function formatLocation(geo: GeoLocation, pos: GridPos): string {
  const { street, city, state } = geo
  const cityState = [city, state].filter(Boolean).join(', ') || 'Unknown'

  if (columnOf(pos) === 'center') {
    // Flat single line — city + state only
    return cityState
  }

  // Left / right edge — two lines: abbreviated road + city, state
  return street ? `${abbreviateStreet(street)}\n${cityState}` : cityState
}

// Expose column helper so companion can set text-align
export { columnOf }
