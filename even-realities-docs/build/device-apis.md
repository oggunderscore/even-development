# Device APIs

*Inputs, audio, IMU, device info, user info, and local storage.*

Source: https://hub.evenrealities.com/docs/build/device-apis

> **Last updated:** 2026-06-11

The bridge exposes inputs (touchpads, ring, IMU), microphone capture, device and user info, and local storage.

## Inputs

The G2 touchpads, the optional R1 ring, and the IMU each provide a distinct input stream:

| Source | Gestures / Data | Notes |
| --- | --- | --- |
| **Even G2 touchpads** (temple) | Press, double press, swipe up, swipe down | Primary input on the glasses frame |
| **Even R1 touchpads** (ring) | Press, double press, swipe up, swipe down | Same gesture set as Even G2, distinguishable by source |
| **IMU** (accelerometer / gyroscope) | Head orientation, motion data | Available for motion-aware apps - see [IMU](#imu) below |

G2 and R1 touchpad events share the same event types but carry distinct sources, so you can route glasses-vs-ring input to different handlers.

### Event types

| Event | Value | Description |
| --- | --- | --- |
| `CLICK_EVENT` | 0 | Single press (Even G2 or Even R1) |
| `SCROLL_TOP_EVENT` | 1 | Swipe up / scroll reaches top boundary |
| `SCROLL_BOTTOM_EVENT` | 2 | Swipe down / scroll reaches bottom boundary |
| `DOUBLE_CLICK_EVENT` | 3 | Double press (Even G2 or Even R1) |

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
})
```

### Event routing

Which container has `isEventCapture: 1` decides where events land:

| Capture container | Events arrive as |
| --- | --- |
| **Text container** | `event.textEvent` |
| **List container** | `event.listEvent` |

Only **one** container per page captures events. Design around a single active target.

## Audio

```typescript
// Start/stop microphone capture
await bridge.audioControl(true) // start
await bridge.audioControl(false) // stop
```

Audio data arrives via `audioEvent` in the event callback. Format: PCM 16kHz, signed 16-bit little-endian, mono.

## IMU

The G2 has an IMU (inertial measurement unit). `imuControl` starts and stops the motion data stream.

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
| `OsEventTypeList` | Event type enum - includes `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`, `IMU_DATA_REPORT` |
| `ImuCtrlCmd` / `ImuCtrlCmdResponse` | Protobuf command/response maps used internally by `imuControl` |

## SDK reference

Method signatures, parameter types, return values, and event payloads all live in the SDK package's TypeScript definitions - the `*.d.ts` files are the authoritative source.

> **npm:** [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## What the SDK doesn't expose

No direct Bluetooth access, no arbitrary pixel drawing, no audio output, no text alignment, no font control, no background colors, no per-item list styling, no programmatic scroll position, no animations, no camera (there is none), and images are greyscale-only.

For the consumer-app version of these same questions - "can I render emoji?", "can I open a WebSocket while backgrounded?", etc. - see the [FAQ](https://hub.evenrealities.com/docs/reference/faq).

### Need more than the public SDK exposes?

The public SDK is tuned for consumer plugin distribution - a stable, sandboxed surface that has to hold up across thousands of third-party apps. If you're building an **enterprise (2B) or government (2G) deployment** with requirements outside that envelope - deeper hardware access, custom firmware behavior, white-labeled distribution, dedicated SLAs, or PaaS-style integration into your own platform - reach out. We work with partners directly on those.

Contact: **[hello@evenrealities.com](mailto:hello@evenrealities.com)**

