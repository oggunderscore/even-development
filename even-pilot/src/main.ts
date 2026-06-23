import { DeviceConnectType, OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { HUD } from './hud'
import { startGps, startMockGps, distanceM, type GpsState } from './gps'
import { reverseGeocode, type GeoLocation } from './geocode'
import { fetchSpeedLimit, activeProviderName } from './speedlimit'
import {
  bearingToCompass, formatSpeed, formatLimit, formatLocation, type SpeedUnit,
} from './format'
import { loadLayout, type Layout } from './layout'
import {
  initCompanion, initDragGrid, log, setStatus,
  setGpsMode, setGpsData, updateChipContent,
} from './companion'

const GEOCODE_INTERVAL_MS         = 10_000
const SPEEDLIMIT_INTERVAL_MS      = 30_000
const SPEEDLIMIT_MOVE_THRESHOLD_M = 100

async function boot() {
  initCompanion()

  const bridge = await waitForEvenAppBridge()
  log('Even Hub bridge ready')

  let currentLayout = loadLayout()
  const hud = new HUD(bridge)

  const initResult = await hud.init(currentLayout)
  if (initResult !== 0) {
    log(`HUD init failed (code ${initResult})`, 'error')
    setStatus('HUD init failed', 'error')
    return
  }
  log('HUD initialized — 4 containers active')
  setStatus('HUD ready', 'ok')

  let lastGeoResult: GeoLocation | null = null

  initDragGrid(currentLayout, async (newLayout: Layout) => {
    currentLayout = newLayout

    // Re-format location for its new grid position before the rebuild
    if (lastGeoResult) {
      const locText = formatLocation(lastGeoResult, newLayout.location)
      hud.currentLocation = locText
      updateChipContent('location', locText)
    }

    await hud.rebuild(newLayout)
  })

  log(`Speed limit provider: ${activeProviderName()}`)

  let unit: SpeedUnit = 'mph'
  let lastGeocodeAt         = 0
  let lastSpeedLimitAt      = 0
  let lastLimitLat          = 0
  let lastLimitLon          = 0
  let lastLimitText         = ''   // last speed value pushed to display
  let lastLimitDetail       = ''   // last log line for null results — dedup
  let stopGps: (() => void) | null = null

  async function onGpsUpdate(state: GpsState, isMock: boolean) {
    const { speedMps, heading, lat, lon } = state

    setGpsMode(isMock ? 'mock' : 'live')
    setGpsData(speedMps, heading, lat, lon, state.accuracy)

    const speedText     = formatSpeed(speedMps, unit)
    const directionText = heading != null ? bearingToCompass(heading) : '--'

    await hud.updateSpeed(speedText)
    await hud.updateDirection(directionText)
    updateChipContent('speed',     speedText)
    updateChipContent('direction', directionText)

    const now = Date.now()

    if (now - lastGeocodeAt > GEOCODE_INTERVAL_MS) {
      lastGeocodeAt = now
      reverseGeocode(lat, lon)
        .then(async geo => {
          lastGeoResult = geo
          const locText = formatLocation(geo, currentLayout.location)
          log(`Location: ${locText.replace('\n', ' / ')}`)
          await hud.updateLocation(locText)
          updateChipContent('location', locText)
        })
        .catch(err => log(`Geocode error: ${err}`, 'warn'))
    }

    const moved = distanceM(lastLimitLat, lastLimitLon, lat, lon)
    if (now - lastSpeedLimitAt > SPEEDLIMIT_INTERVAL_MS || moved > SPEEDLIMIT_MOVE_THRESHOLD_M) {
      lastSpeedLimitAt = now
      lastLimitLat = lat
      lastLimitLon = lon
      fetchSpeedLimit(lat, lon).then(async result => {
        if (result.mph == null) {
          // No maxspeed tag — keep last displayed value, log only when status changes
          const detail = result.hasRoad
            ? `no tag · ${result.highway ?? 'road'}`
            : 'no road within range'
          if (detail !== lastLimitDetail) {
            lastLimitDetail = detail
            log(`Speed limit: ${detail} — display unchanged`)
          }
          return
        }
        // Got a real value — update display and chip
        const text = formatLimit(result.mph)
        lastLimitDetail = `${text} mph · ${result.highway ?? 'road'}`
        if (text !== lastLimitText) {
          lastLimitText = text
          log(`Speed limit: ${result.mph} mph · ${result.highway ?? 'road'} (OSM)`)
          await hud.updateSpeedLimit(text)
          updateChipContent('limit', `${text} max`)
        }
      })
    }
  }

  log('Requesting GPS…')
  stopGps = startGps(
    state => onGpsUpdate(state, false),
    err => {
      log(`GPS: ${err.message}`, err.fatal ? 'error' : 'warn')
      if (err.fatal) {
        log('Permission denied — falling back to mock GPS', 'warn')
        setGpsMode('error')
        setStatus('Mock GPS active — grant location permission to use real GPS', 'warn')
        hud.updateLocation('Mock GPS · no permission').catch(console.error)
        updateChipContent('location', 'Mock GPS · no permission')
        stopGps = startMockGps(state => onGpsUpdate(state, true))
      }
    },
  )

  bridge.onDeviceStatusChanged(status => {
    const ok   = status.connectType === DeviceConnectType.Connected
    const batt = status.batteryLevel ?? '?'
    log(`Glasses ${ok ? `connected · ${batt}%` : status.connectType}`)
    if (ok) setStatus(`Glasses · ${batt}%`, 'ok')
  })

  const unsub = bridge.onEvenHubEvent(event => {
    const sysType  = event.sysEvent?.eventType  ?? -1
    const textType = event.textEvent?.eventType ?? 0  // CLICK_EVENT=0; protobuf omits zero

    if (sysType  === OsEventTypeList.DOUBLE_CLICK_EVENT ||
        textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      log('Double-tap → exiting')
      stopGps?.()
      unsub()
      bridge.shutDownPageContainer()
      return
    }

    if (textType === OsEventTypeList.CLICK_EVENT) {
      unit = unit === 'mph' ? 'kmh' : 'mph'
      log(`Unit → ${unit}`)
      return
    }

    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
        sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      log('System exit', 'warn')
      stopGps?.()
      unsub()
    }
  })
}

void boot().catch(err => {
  log(`Boot error: ${err}`, 'error')
  console.error(err)
})
