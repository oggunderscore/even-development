// Speed limit provider system — pluggable for future Waze, HERE, TomTom integration

// ── Provider interface ────────────────────────────────────────────────────────

export interface SpeedLimitProvider {
  readonly name: string
  /** Returns speed limit in mph, or null if unavailable. Must never throw. */
  fetchLimit(lat: number, lon: number): Promise<SpeedLimitResult>
}

export interface SpeedLimitResult {
  mph:     number | null   // null = no maxspeed tag; display keeps last real value
  highway: string | null   // OSM highway type of nearest road, if found
  hasRoad: boolean          // true = road found but no maxspeed tag; false = no road in range
}

// ── OpenStreetMap / Overpass provider ─────────────────────────────────────────

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const

const FETCH_TIMEOUT_MS = 9_000
const SEARCH_RADIUS    = 200   // meters — generous to survive GPS drift and OSM offsets

class OverpassProvider implements SpeedLimitProvider {
  readonly name = 'OpenStreetMap (Overpass)'

  async fetchLimit(lat: number, lon: number): Promise<SpeedLimitResult> {
    // Query ALL highway ways in range — no [maxspeed] filter.
    // Filtering in JS lets us distinguish "no road" from "road with no tag".
    const elements = await this.runQuery(
      `[out:json][timeout:8];way(around:${SEARCH_RADIUS},${lat},${lon})[highway];out tags;`,
    )

    if (!elements) return { mph: null, highway: null, hasRoad: false }
    if (elements.length === 0) return { mph: null, highway: null, hasRoad: false }

    // Prefer the first element that has an explicit maxspeed tag
    let firstHighway: string | null = null
    for (const el of elements) {
      const hw = el.tags?.highway ?? null
      if (!firstHighway && hw) firstHighway = hw

      const mph = parseMaxspeed(el.tags?.maxspeed)
      if (mph != null) return { mph, highway: hw, hasRoad: true }
    }

    // Roads found but none have a maxspeed tag
    return { mph: null, highway: firstHighway, hasRoad: true }
  }

  private async runQuery(
    query: string,
  ): Promise<Array<{ tags?: { maxspeed?: string; highway?: string } }> | null> {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        let res: Response
        try {
          res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }

        if (!res.ok) continue

        const data = await res.json() as { elements: Array<{ tags?: Record<string, string> }> }
        return data.elements
      } catch {
        // Network error or abort — try next endpoint
      }
    }
    return null  // all endpoints failed silently
  }
}

// ── Waze provider stub ────────────────────────────────────────────────────────
// Waze has no public speed limit API; requires partnership access.
//
// export class WazeProvider implements SpeedLimitProvider {
//   readonly name = 'Waze'
//   async fetchLimit(lat, lon): Promise<SpeedLimitResult> {
//     return { mph: null, highway: null, hasRoad: false }
//   }
// }

// ── HERE Maps provider stub ───────────────────────────────────────────────────
// https://developer.here.com/documentation/routing-api/dev_guide/topics/use-cases/speed-limits.html
//
// export class HereProvider implements SpeedLimitProvider {
//   readonly name = 'HERE Maps'
//   constructor(private readonly apiKey: string) {}
//   async fetchLimit(lat, lon): Promise<SpeedLimitResult> {
//     return { mph: null, highway: null, hasRoad: false }
//   }
// }

// ── Registry ──────────────────────────────────────────────────────────────────

export const PROVIDERS: Record<string, SpeedLimitProvider> = {
  overpass: new OverpassProvider(),
}

let active: SpeedLimitProvider = PROVIDERS.overpass

export function setSpeedLimitProvider(p: SpeedLimitProvider): void { active = p }
export function activeProviderName(): string { return active.name }

/** Fetch speed limit. Never throws — returns null result on any error. */
export async function fetchSpeedLimit(lat: number, lon: number): Promise<SpeedLimitResult> {
  try {
    return await active.fetchLimit(lat, lon)
  } catch {
    return { mph: null, highway: null, hasRoad: false }
  }
}

// ── OSM maxspeed tag parser ───────────────────────────────────────────────────
// Handles: "65 mph", "65", "100 km/h", "120 kph", bare number (OSM default = km/h)
function parseMaxspeed(raw: string | undefined): number | null {
  if (!raw) return null
  const mph = raw.match(/^(\d+)\s*mph$/i)
  if (mph) return parseInt(mph[1], 10)
  const kmh = raw.match(/^(\d+)(?:\s*(?:km\/h|kph))?$/i)
  if (kmh) return Math.round(parseInt(kmh[1], 10) / 1.60934)
  return null
}
