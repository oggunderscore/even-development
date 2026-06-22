import { type Layout, type ComponentId, type GridPos, DEFAULT_LAYOUT, saveLayout } from './layout'

const LABEL: Record<ComponentId, string> = {
  speed: 'Speed', limit: 'Limit', direction: 'Direction', location: 'Location',
}

const liveValues: Record<ComponentId, string> = {
  speed: '-- mph', limit: '--', direction: '--', location: 'Acquiring GPS…',
}

let currentLayout: Layout
let layoutChangeCallback: (layout: Layout) => void

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCompanion(): void {
  setStatus('Initializing…', 'warn')
}

export function initDragGrid(layout: Layout, onChange: (l: Layout) => void): void {
  currentLayout = { ...layout }
  layoutChangeCallback = onChange
  renderGrid()

  document.querySelectorAll<HTMLElement>('.hud-slot').forEach(setupDropTarget)

  document.getElementById('reset-layout')?.addEventListener('click', () => {
    currentLayout = { ...DEFAULT_LAYOUT }
    saveLayout(currentLayout)
    renderGrid()
    layoutChangeCallback(currentLayout)
    log('Layout reset to default')
  })
}

// ── Grid render ───────────────────────────────────────────────────────────────

function renderGrid(): void {
  document.querySelectorAll<HTMLElement>('.hud-slot').forEach(slot => {
    slot.innerHTML = ''
    slot.classList.remove('occupied')
  })
  for (const [id, pos] of Object.entries(currentLayout) as [ComponentId, GridPos][]) {
    const slot = document.querySelector<HTMLElement>(`.hud-slot[data-pos="${pos}"]`)
    if (!slot) continue
    slot.appendChild(buildChip(id))
    slot.classList.add('occupied')
  }
}

// Writes text into an element, turning \n into real <br> nodes so CSS
// line-count capping works reliably without white-space: pre-wrap quirks.
function setNodeContent(el: HTMLElement, text: string): void {
  el.innerHTML = ''
  text.split('\n').forEach((part, i) => {
    if (i > 0) el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode(part))
  })
}

function buildChip(id: ComponentId): HTMLElement {
  const chip = document.createElement('div')
  chip.className = `grid-chip chip-${id}`
  chip.draggable = true
  chip.dataset.component = id

  const label = document.createElement('span')
  label.className = 'chip-label'
  label.textContent = LABEL[id]

  const value = document.createElement('span')
  value.className = 'chip-value'
  value.id = `chip-val-${id}`
  setNodeContent(value, liveValues[id])

  chip.appendChild(label)
  chip.appendChild(value)

  chip.addEventListener('dragstart', e => {
    e.dataTransfer!.setData('text/plain', id)
    e.dataTransfer!.effectAllowed = 'move'
    document.getElementById('hud-canvas')?.classList.add('drag-active')
    setTimeout(() => chip.classList.add('dragging'), 0)
  })
  chip.addEventListener('dragend', () => {
    document.getElementById('hud-canvas')?.classList.remove('drag-active')
    chip.classList.remove('dragging')
  })
  return chip
}

function setupDropTarget(slot: HTMLElement): void {
  slot.addEventListener('dragover', e => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    slot.classList.add('drag-over')
  })
  slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'))
  slot.addEventListener('drop', e => {
    e.preventDefault()
    slot.classList.remove('drag-over')
    document.getElementById('hud-canvas')?.classList.remove('drag-active')

    const draggedId = e.dataTransfer?.getData('text/plain') as ComponentId | undefined
    const targetPos = slot.dataset.pos as GridPos | undefined
    if (!draggedId || !targetPos) return
    if (currentLayout[draggedId] === targetPos) return

    const occupant = (Object.keys(currentLayout) as ComponentId[])
      .find(k => currentLayout[k] === targetPos)
    const fromPos = currentLayout[draggedId]

    currentLayout[draggedId] = targetPos
    if (occupant) currentLayout[occupant] = fromPos

    saveLayout(currentLayout)
    renderGrid()
    layoutChangeCallback(currentLayout)
    log(`Moved ${LABEL[draggedId]} → ${targetPos}${occupant ? `, swapped with ${LABEL[occupant]}` : ''}`)
  })
}

// ── Live value updates ────────────────────────────────────────────────────────

export function updateChipContent(id: ComponentId, value: string): void {
  liveValues[id] = value
  const el = document.getElementById(`chip-val-${id}`)
  if (el) setNodeContent(el, value)
}

// ── Status / badges ───────────────────────────────────────────────────────────

export function setStatus(msg: string, type: 'ok' | 'warn' | 'error' = 'ok'): void {
  const el = document.getElementById('status-badge')
  if (!el) return
  el.textContent = msg
  el.className = `badge badge-${type}`
}

export function setGpsMode(mode: 'live' | 'mock' | 'error'): void {
  const el = document.getElementById('gps-badge')
  if (!el) return
  const label = { live: 'Live', mock: 'Mock GPS', error: 'No signal' }
  const cls   = { live: 'ok',  mock: 'warn',     error: 'error'     }
  el.textContent = label[mode]
  el.className = `badge badge-${cls[mode]}`
}

export function setGpsData(
  speedMps: number | null, heading: number | null,
  lat: number, lon: number, accuracy: number,
): void {
  setText('gps-speed',    speedMps != null
    ? `${(speedMps * 2.23694).toFixed(1)} mph / ${(speedMps * 3.6).toFixed(1)} km/h` : '--')
  setText('gps-heading',  heading != null ? `${Math.round(heading)}°` : '--')
  setText('gps-coords',   `${lat.toFixed(6)}, ${lon.toFixed(6)}`)
  setText('gps-accuracy', `±${Math.round(accuracy)} m`)
}

// ── Activity log ──────────────────────────────────────────────────────────────

export function log(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const container = document.getElementById('log-entries')
  if (!container) return
  const entry = document.createElement('div')
  entry.className = `log-entry log-${level}`
  entry.textContent = `${ts()}  ${msg}`
  container.prepend(entry)
  while (container.children.length > 120) container.lastChild?.remove()
}

function setText(id: string, val: string): void {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function ts(): string {
  return new Date().toLocaleTimeString([], { hour12: false })
}
