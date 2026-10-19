# Device APIs

*Inputs, audio, IMU, location, photos, device info, user info, and local storage.*

Source: https://hub.evenrealities.com/docs/build/device-apis

> **Last updated:** 2026-08-29

The bridge exposes inputs (touchpads, ring, IMU), microphone capture, location, photo picker / camera capture, device and user info, and local storage.

## Inputs

The Even G2 touchpads, the optional R1 ring, and the IMU each provide a distinct input stream:

| Source | Gestures / Data | Notes |
| --- | --- | --- |
| **Even G2 touchpads** (temple) | Press, double press, swipe up, swipe down, long press and release | Primary input on the glasses frame |
| **Even R1 touchpads** (ring) | Press, double press, swipe up, swipe down, long press and release | Same gesture set as Even G2, distinguishable by source |
| **IMU** (accelerometer / gyroscope) | Head orientation, motion data | Available for motion-aware apps - see [IMU](#imu) below |

Even G2 and R1 touchpad events share the same event types but carry distinct sources, so you can route glasses-vs-ring input to different handlers.

### Event types

| Event | Value | Description |
| --- | --- | --- |
| `CLICK_EVENT` | 0 | Single press (Even G2 or Even R1) |
| `SCROLL_TOP_EVENT` | 1 | Swipe up / scroll reaches top boundary |
| `SCROLL_BOTTOM_EVENT` | 2 | Swipe down / scroll reaches bottom boundary |
| `DOUBLE_CLICK_EVENT` | 3 | Double press (Even G2 or Even R1) |
| `LONG_PRESS_EVENT` | 9 | Long press begins (SDK `0.0.14+`, Even App `2.2.9+`) |
| `LONG_PRESS_RELEASE_EVENT` | 10 | That long press is released (SDK `0.0.14+`, Even App `2.2.9+`) |

### Long press

A **long press** - a sustained press on a temple or ring touchpad - reaches your app as **two** events (SDK `0.0.14+`, Even App `2.2.9+`), one when the press starts, one when the finger lifts:

```typescript
let pressStartedAt = 0

bridge.onEvenHubEvent(event => {
  // Both events arrive on sysEvent, whichever container is capturing.
  const type = event.sysEvent?.eventType

  if (type === OsEventTypeList.LONG_PRESS_EVENT) {
    pressStartedAt = Date.now()
    showChargingIndicator()
  }
  if (type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
    fire(Date.now() - pressStartedAt)
  }
})
```

Both events always arrive on `event.sysEvent`, whichever container holds `isEventCapture`, and `eventSource` is absent on them. The [routing table](#event-routing) governs scrolling and selection, not this pair. There is no separate subscription - they reach the same `onEvenHubEvent` callback as everything else.

Two things to hold onto:

- **A rebuild mid-press keeps the pair intact.** Rebuilding the page while the finger is still down still delivers `LONG_PRESS_RELEASE_EVENT`.
- **The OS claims tap then long press for its own menu.** A tap followed by a sustained press raises the contextual menu, so whether a press reaches your app depends on which layer owns it. Treat the pair as an enhancement, not the only path to a feature - see [Contextual Menu](/docs/build/contextual-menu).

Simulator `0.9.0+` simulates the press in its window - hold the control, or use its keyboard shortcut; `0.9.1+` delivers both events over the [automation API](/docs/test/simulator#glasses-input), so long-press handling is scriptable in CI.

### Handling events

```typescript
bridge.onEvenHubEvent(event => {
  const textEvent = event.textEvent
  if (textEvent) {
    const eventType = textEvent.eventType

    switch (eventType) {
      case OsEventTypeList.CLICK_EVENT:
      case undefined: // SDK normalizes 0 to undefined in some cases
        // Handle press
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Handle double press
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        // Handle swipe up / scroll up
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        // Handle swipe down / scroll down
        break
    }
  }

  // Long press never reaches the capturing container.
  switch (event.sysEvent?.eventType) {
    case OsEventTypeList.LONG_PRESS_EVENT:
      // Long press started (SDK 0.0.14+)
      break
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      // Long press released (SDK 0.0.14+)
      break
  }
})
```

### Event routing

Which container has `isEventCapture: 1` decides where events land:

| Capture container | Events arrive as |
| --- | --- |
| **Text container** | `event.textEvent` |
| **List container** | `event.listEvent` |

Only **one** container per page captures events. Design around a single active target.

Two things bypass that table entirely, arriving on the same subscription no matter which container is capturing:

- **Contextual-menu selections** arrive as `event.menuItemClickEvent`. See [Contextual Menu](/docs/build/contextual-menu).
- **Long press** arrives as `event.sysEvent`, with `eventSource` absent. See [Long press](#long-press).

## Audio

Capture audio from the **glasses four-mic array** or the **phone microphone**. Pick the source on every `audioControl(true, ...)` call - default is glasses if you omit the second arg.

```typescript
import { AudioInputSource, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

await bridge.audioControl(true, AudioInputSource.Glasses) // start - G2 mics
// await bridge.audioControl(true, AudioInputSource.Phone) // start - phone mic
await bridge.audioControl(false)                          // stop
```

### `AudioInputSource`

| Value | Source | Notes |
| --- | --- | --- |
| `AudioInputSource.Glasses` | Even G2 four-mic array | Default. Requires `createStartUpPageContainer` to have run first. |
| `AudioInputSource.Phone` | Phone microphone | No startup-page requirement; routes through the phone the WebView lives on. |

Audio data arrives via `audioEvent` in the event callback:

```typescript
bridge.onEvenHubEvent(event => {
  const audio = event.audioEvent
  if (!audio) return
  // audio.source: AudioInputSource.Glasses | AudioInputSource.Phone
  // audio.audioPcm: Uint8Array - PCM 16 kHz, signed 16-bit little-endian, mono
})
```

Format on both sources: **PCM 16 kHz, signed 16-bit little-endian, mono**. The `source` field tells you which mic the buffer came from - useful if you `audioControl(true, ...)` between sources at runtime.

Permissions: `g2-microphone` for `Glasses`, `phone-microphone` for `Phone`. See [Packaging § Permissions](/docs/ship/packaging#permissions-format).

## Location

Two modes - one-shot (`getAppLocation`) and continuous (`startAppLocationUpdates` + `onAppLocationChanged`). Both read from the phone's location services; declare `location` in `app.json` permissions before calling.

### One-shot

```typescript
import { AppLocationAccuracy, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

const fix = await bridge.getAppLocation({
  accuracy: AppLocationAccuracy.High,
  timeoutMs: 5000,
})

if (fix) {
  console.log(fix.latitude, fix.longitude)
}
```

Returns `null` when the host has no fix in time, the user denied permission, or the coordinates are invalid - always null-check.

### Continuous

```typescript
await bridge.startAppLocationUpdates({
  accuracy: AppLocationAccuracy.Medium,
  intervalMs: 1000,
  distanceFilter: 5, // meters - host skips pushes smaller than this
})

const unsubscribe = bridge.onAppLocationChanged(loc => {
  console.log(loc.latitude, loc.longitude, loc.speed)
})

// Later:
await bridge.stopAppLocationUpdates()
unsubscribe()
```

`AppLocationOptions` fields - `accuracy`, `timeoutMs` (one-shot only), `intervalMs` and `distanceFilter` (continuous only). All optional; the host picks sensible defaults.

### `AppLocationAccuracy`

| Value | Use for |
| --- | --- |
| `AppLocationAccuracy.Low` | City-level - cheapest, kindest to battery |
| `AppLocationAccuracy.Medium` | Block-level - balanced default |
| `AppLocationAccuracy.High` | Best available fix - most battery |

### `AppLocation` shape

| Field | Type | Notes |
| --- | --- | --- |
| `latitude` | number | Degrees |
| `longitude` | number | Degrees |
| `accuracy` | number? | Horizontal accuracy in meters |
| `altitude` | number? | Meters above sea level (when available) |
| `speed` | number? | Meters per second (when available) |
| `heading` | number? | Degrees from true north (when available) |
| `timestamp` | number? | Unix milliseconds (when available) |

## Photos

Two ways to bring an image into your app from the **phone** - pick from the photo album or capture from the phone camera. Both are single-shot, return one `AppImageAsset`, and use phone hardware (the Even G2 has no camera).

```typescript
const fromAlbum = await bridge.pickImageFromAlbum()      // requires `album` permission
const fromCamera = await bridge.captureImageFromCamera() // requires `camera` permission

if (fromAlbum) {
  // fromAlbum.base64 is ready to drop into an <img src="data:...">
}
```

Both calls return `null` when the user cancels the picker / camera, or denies permission. The album picker is **single-select only** - no multi-import.

### `AppImageAsset` shape

| Field | Type | Notes |
| --- | --- | --- |
| `path` | string | Host-side path; opaque to the WebView |
| `name` | string | Original filename |
| `mimeType` | string | e.g. `image/jpeg`, `image/png` |
| `size` | number | Bytes |
| `base64` | string | Inline data, ready for `<img>` or further processing |

The image arrives in the WebView as base64 - there's no fetch-from-disk step. Watch `size`: a 12-megapixel JPEG is several MB of base64, which is fine to display but expensive to pump into a glasses container via `updateImageRawData`. Downscale before sending pixels to the glasses.

## IMU

The Even G2 has an IMU (inertial measurement unit). `imuControl` starts and stops the motion data stream.

```typescript
import { waitForEvenAppBridge, ImuReportPace, OsEventTypeList } from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

// Start IMU reporting
await bridge.imuControl(true, ImuReportPace.P500)

// Listen for IMU data
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sys = event.sysEvent
  if (!sys?.imuData) return
  if (sys.eventType !== OsEventTypeList.IMU_DATA_REPORT) return

  const { x, y, z } = sys.imuData
  console.log('IMU:', x, y, z)
})

// Stop IMU reporting
await bridge.imuControl(false)
unsubscribe()
```

### `imuControl(isOpen, reportFrq)`

| Parameter | Type | Description |
| --- | --- | --- |
| `isOpen` | boolean | `true` to start, `false` to stop |
| `reportFrq` | `ImuReportPace` | Pacing code for report frequency (optional when stopping - defaults to `P100`) |

### `ImuReportPace`

The `reportFrq` parameter accepts one of the following pacing codes:

| Value | Constant |
| --- | --- |
| 100 | `ImuReportPace.P100` |
| 200 | `ImuReportPace.P200` |
| 300 | `ImuReportPace.P300` |
| 400 | `ImuReportPace.P400` |
| 500 | `ImuReportPace.P500` |
| 600 | `ImuReportPace.P600` |
| 700 | `ImuReportPace.P700` |
| 800 | `ImuReportPace.P800` |
| 900 | `ImuReportPace.P900` |
| 1000 | `ImuReportPace.P1000` |

These are protocol pacing codes, not literal Hz values.

### IMU data shape

IMU samples arrive as `Sys_ItemEvent` through `event.sysEvent` in `onEvenHubEvent`. Each sample:

| Field | Type | Description |
| --- | --- | --- |
| `eventType` | `OsEventTypeList` | `IMU_DATA_REPORT` for IMU samples |
| `imuData.x` | float | X-axis value |
| `imuData.y` | float | Y-axis value |
| `imuData.z` | float | Z-axis value |

`imuData` is an `IMU_Report_Data` protobuf. Once `imuControl(true, ...)` fires, samples push continuously until `imuControl(false)` stops them.

## Device info

```typescript
const info = await bridge.getDeviceInfo()
// Returns: model (G1/G2/Ring1), serial number, battery, wearing status, charging, in-case
```

Real-time monitoring:

```typescript
bridge.onDeviceStatusChanged(status => {
  // Battery, wearing, charging updates
})
```

## User info

```typescript
const user = await bridge.getUserInfo()
// Returns: uid, name, avatar, country
```

## Local storage

```typescript
await bridge.setLocalStorage('key', 'value')
const value = await bridge.getLocalStorage('key')
```

## OS event models

Models the SDK exposes for OS-to-app events:

| Model | Description |
| --- | --- |
| `Text_ItemEvent` | Text container event |
| `List_ItemEvent` | List container event |
| `Sys_ItemEvent` | System event - carries `eventType`, `eventSource`, `imuData` |
| `IMU_Report_Data` | IMU sample payload (`x`, `y`, `z` floats) inside `Sys_ItemEvent.imuData` |
| `AudioEventPayload` | Microphone payload on `event.audioEvent` - `source` (`AudioInputSource.Glasses` | `AudioInputSource.Phone`) and `audioPcm` (`Uint8Array`) |
| `MenuItemClickEvent` | Contextual-menu selection on `event.menuItemClickEvent` - carries the `itemID` you declared (SDK `0.0.14+`) |
| `OsEventTypeList` | Event type enum - includes `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`, `IMU_DATA_REPORT`, `LONG_PRESS_EVENT`, `LONG_PRESS_RELEASE_EVENT` |
| `ImuCtrlCmd` / `ImuCtrlCmdResponse` | Protobuf command/response maps used internally by `imuControl` |

## SDK reference

Method signatures, parameter types, return values, and event payloads all live in the SDK package's TypeScript definitions - the `*.d.ts` files are the authoritative source.

> **npm:** [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## What the SDK doesn't expose

No direct Bluetooth access, no arbitrary pixel drawing, no audio output, no text alignment, no font control, no background colors, no per-item list styling, no programmatic scroll position, no animations, no glasses-side camera (the Even G2 has none - the phone camera is reachable via `captureImageFromCamera`), and images are greyscale-only.

For the consumer-app version of these same questions - "can I render emoji?", "can I open a WebSocket while backgrounded?", etc. - see the [FAQ](/docs/reference/faq).

### Need more than the public SDK exposes?

The public SDK is tuned for consumer plugin distribution - a stable, sandboxed surface that has to hold up across thousands of third-party apps. If you're building an **enterprise (2B) or government (2G) deployment** with requirements outside that envelope - deeper hardware access, custom firmware behavior, white-labeled distribution, dedicated SLAs, or PaaS-style integration into your own platform - reach out. We work with partners directly on those.

Contact: **[software@evenrealities.com](mailto:software@evenrealities.com)**
