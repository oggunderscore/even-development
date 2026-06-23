// 3×3 grid layout system for the 576×288 glasses display

export type GridPos     = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
export type ComponentId = 'speed' | 'limit' | 'direction' | 'location'
export type Layout      = Record<ComponentId, GridPos>

const STORAGE_KEY = 'evenpilot-layout-v1'

// Each cell: 192×96 px  (576/3 × 288/3)
const COL_W = 192
const ROW_H = 96

const COL: Record<GridPos, number> = { tl: 0, tc: 1, tr: 2, ml: 0, mc: 1, mr: 2, bl: 0, bc: 1, br: 2 }
const ROW: Record<GridPos, number> = { tl: 0, tc: 0, tr: 0, ml: 1, mc: 1, mr: 1, bl: 2, bc: 2, br: 2 }

export interface CellRect { x: number; y: number; w: number; h: number }

export function cellRect(pos: GridPos): CellRect {
  return { x: COL[pos] * COL_W, y: ROW[pos] * ROW_H, w: COL_W, h: ROW_H }
}

export function rowOf(pos: GridPos): 'top' | 'mid' | 'bot' {
  const r = ROW[pos]
  return r === 0 ? 'top' : r === 2 ? 'bot' : 'mid'
}

export const DEFAULT_LAYOUT: Layout = {
  direction: 'tl',   // top-left
  location:  'tc',   // top-center
  speed:     'mc',   // center
  limit:     'br',   // bottom-right
}

export function saveLayout(layout: Layout): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)) } catch {}
}

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Layout>
      const ids: ComponentId[] = ['speed', 'limit', 'direction', 'location']
      if (ids.every(k => k in p)) return p as Layout
    }
  } catch {}
  return { ...DEFAULT_LAYOUT }
}
