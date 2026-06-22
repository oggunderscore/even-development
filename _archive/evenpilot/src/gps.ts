export interface GpsState {
  speedMps: number | null
  heading: number | null
  lat: number
  lon: number
  accuracy: number
}

export interface GpsError {
  message: string
  fatal: boolean  // true for PERMISSION_DENIED — won't recover without user action
}

export function startGps(
  onUpdate: (state: GpsState) => void,
  onError: (err: GpsError) => void,
): () => void {
  if (!navigator.geolocation) {
    onError({ message: 'Geolocation API not available', fatal: true })
    return () => {}
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onUpdate({
        speedMps: pos.coords.speed,
        heading: pos.coords.heading,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
    },
    (err) => {
      // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
      onError({
        message: err.message,
        fatal: err.code === 1,
      })
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 1_000 },
  )

  return () => navigator.geolocation.clearWatch(watchId)
}

// Mock GPS — simulates highway driving near Fullerton, CA for simulator/dev use
export function startMockGps(
  onUpdate: (state: GpsState) => void,
): () => void {
  let running = true
  let lat = 33.8707       // I-5 near Fullerton, CA
  let lon = -117.9254
  let speedMps = 28.5     // ~63 mph
  let heading = 350       // heading roughly north (I-5 northbound)

  const interval = setInterval(() => {
    if (!running) return

    // Small random walk on speed (55–75 mph range)
    speedMps = Math.max(24.6, Math.min(33.5, speedMps + (Math.random() - 0.5) * 0.4))
    // Slight heading drift
    heading = ((heading + (Math.random() - 0.5) * 3) + 360) % 360

    // Advance position along heading
    const dist = speedMps * 1 // meters per second × 1s tick
    lat += (dist * Math.cos(heading * Math.PI / 180)) / 111_320
    lon += (dist * Math.sin(heading * Math.PI / 180)) / (111_320 * Math.cos(lat * Math.PI / 180))

    onUpdate({ speedMps, heading, lat, lon, accuracy: 5 })
  }, 1000)

  return () => {
    running = false
    clearInterval(interval)
  }
}

// Haversine distance in meters between two lat/lon points
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
