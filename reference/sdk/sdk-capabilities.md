# Even Realities G2 — SDK Capabilities Reference

> **What data and hardware can you actually read, write, and react to?**
>
> Sources: `@evenrealities/even_hub_sdk@0.0.10` type definitions, official Even Hub docs (fetched 2026-06-15).
> Covers the public plugin SDK only. Enterprise/government (2B/2G) deployments may negotiate deeper hardware access via hello@evenrealities.com.

---

## TL;DR — Capability Map

| Category | Available | Not Available |
|---|---|---|
| **Display** | 576×288 greyscale canvas, text/image/list containers | Arbitrary pixels, color, animations, custom fonts |
| **Input — Glasses** | Tap, double-tap, swipe up/down on temple touchpad | Long-press, multi-touch |
| **Input — Ring (R1)** | Same 4 gestures as glasses, distinguishable by source | Haptic feedback |
| **IMU** | X/Y/Z motion stream at configurable rate | Raw quaternion, calibrated orientation units (TBD) |
| **Audio** | G2 4-mic array → PCM 16kHz mono | Per-mic selection, DOA angle, audio output/speaker |
| **Device status** | Battery %, wearing state, charging, in-case, serial | Raw BLE RSSI, firmware version |
| **User info** | UID, name, avatar URL, country | Email, contacts, calendar, health, location via bridge |
| **Geolocation** | `navigator.geolocation` (WebView) | GPS on the glasses themselves |
| **Networking** | `fetch()`, WebSockets (whitelisted origins) | Arbitrary URLs, push while backgrounded |
| **Storage** | `localStorage`, `IndexedDB`, `OPFS` | File system, media library, clipboard, cross-app data |
| **Camera** | N/A — no camera on G2 (privacy-by-design) | — |
| **Health data** | None | No heart rate, steps, sleep, SpO2 |

---

## 1. Input — Touchpads

### Sources

Both input sources produce the same 4 event types. Distinguish them via `eventSource`.

| Source | `EventSourceType` value | Physical location |
|---|---|---|
| Right temple (glasses) | `TOUCH_EVENT_FROM_GLASSES_R = 1` | Right arm of the frame |
| Left temple (glasses) | `TOUCH_EVENT_FROM_GLASSES_L = 3` | Left arm of the frame |
| R1 ring | `TOUCH_EVENT_FROM_RING = 2` | Optional accessory ring |

### Gesture / Event types

| Gesture | `OsEventTypeList` | Wire value | Notes |
|---|---|---|---|
| Single tap | `CLICK_EVENT` | **0** | **Arrives as `undefined`** — protobuf drops zero-value fields. Always coerce `?? 0` |
| Double tap | `DOUBLE_CLICK_EVENT` | 3 | Check both `sysEvent` and `textEvent` envelopes |
| Swipe up | `SCROLL_TOP_EVENT` | 1 | |
| Swipe down | `SCROLL_BOTTOM_EVENT` | 2 | |

### Reading input

```typescript
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

const unsub = bridge.onEvenHubEvent(event => {
  const source = event.sysEvent?.eventSource   // EventSourceType (1/2/3)
  const sysType  = event.sysEvent?.eventType  ?? -1
  const textType = event.textEvent?.eventType ?? 0   // 0 = CLICK

  switch (textType) {
    case OsEventTypeList.CLICK_EVENT:        // 0 / undefined
    case OsEventTypeList.DOUBLE_CLICK_EVENT: // 3
    case OsEventTypeList.SCROLL_TOP_EVENT:   // 1
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:// 2
  }
})
```

### Event routing rules

- Only the **one** container with `isEventCapture: 1` receives input events.
- Text container capture → `event.textEvent`
- List container capture → `event.listEvent`

### Limitations

- No long-press detection
- No multi-touch (single touchpad per side)
- No haptics on glasses or R1

---

## 2. IMU (Gyroscope / Accelerometer)

The G2 frame has a built-in IMU. Motion data streams as X/Y/Z floats at a configurable rate.

### Starting the stream

```typescript
import { ImuReportPace, OsEventTypeList } from '@evenrealities/even_hub_sdk'

await bridge.imuControl(true, ImuReportPace.P500)   // start at pace 500

const unsub = bridge.onEvenHubEvent(event => {
  if (event.sysEvent?.eventType !== OsEventTypeList.IMU_DATA_REPORT) return
  const { x, y, z } = event.sysEvent.imuData ?? {}
  // x, y, z are floats
})

// Stop
await bridge.imuControl(false)
unsub()
```

### Report pacing codes

`ImuReportPace` values are **protocol pacing codes**, not literal Hz values. The actual sample rate they correspond to is not yet documented.

| Constant | Value |
|---|---|
| `ImuReportPace.P100` | 100 |
| `ImuReportPace.P200` | 200 |
| `ImuReportPace.P300` | 300 |
| `ImuReportPace.P400` | 400 |
| `ImuReportPace.P500` | 500 |
| `ImuReportPace.P600` | 600 |
| `ImuReportPace.P700` | 700 |
| `ImuReportPace.P800` | 800 |
| `ImuReportPace.P900` | 900 |
| `ImuReportPace.P1000` | 1000 |

### IMU data shape

```typescript
// IMU_Report_Data (inside event.sysEvent.imuData)
{ x?: number; y?: number; z?: number }
```

> **Units are TBD.** The official FAQ says: "A units table is still TBD." Don't assume m/s², rad/s, or degrees — treat as relative/comparative values until documented.

### What IMU can power

- Head-nod / head-shake detection
- Orientation-aware UIs (landscape vs. portrait wear)
- Motion triggers (walking, running cadence approximation)
- Gesture recognition via custom signal processing

### What IMU cannot do

- No compass / magnetometer data exposed
- No GPS or absolute position
- No step counting or health inference (the SDK doesn't aggregate)
- No per-axis calibration API

---

## 3. Audio — Microphone

The G2 has a **4-microphone array**. The SDK exposes a mono PCM stream; per-mic selection and direction-of-arrival (DOA) are on the roadmap but not yet available.

### Requires permission

```json
{ "name": "g2-microphone", "desc": "Voice commands for hands-free control." }
```

> `"microphone"` (old key) and `"g2-microphone"` (current key) both appear in different docs — use `"g2-microphone"` per the packaging schema.

### Starting capture

```typescript
await bridge.audioControl(true)   // start mic

const unsub = bridge.onEvenHubEvent(event => {
  if (!event.audioEvent) return
  const pcm: Uint8Array = event.audioEvent.audioPcm
  // PCM format: 16 kHz, signed 16-bit, little-endian, mono
})

await bridge.audioControl(false)  // stop mic
```

### Audio format

| Property | Value |
|---|---|
| Sample rate | 16 kHz |
| Channels | Mono (1) |
| Encoding | Signed 16-bit PCM, little-endian |
| Delivery | Chunked via `event.audioEvent.audioPcm` (Uint8Array) |

### Background behavior

`audioControl(true)` stops if the WebView is suspended on Android. Re-enable on foreground entry:

```typescript
bridge.onEvenHubEvent(event => {
  if (event.sysEvent?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    bridge.audioControl(true)  // re-enable capture
  }
})
```

### What's not available

- Per-microphone channel selection (roadmap)
- Direction-of-arrival / beamforming (roadmap)
- Speaker / audio output (no speaker on G2)
- Noise suppression or echo cancellation API

---

## 4. Device Status

### One-time query

```typescript
const info = await bridge.getDeviceInfo()
// DeviceInfo:
// {
//   model: 'g1' | 'g2' | 'ring1'
//   sn: string          // serial number
//   status: DeviceStatus
// }
```

### Real-time status stream

```typescript
bridge.onDeviceStatusChanged(status => {
  // DeviceStatus:
  // {
  //   sn: string
  //   connectType: 'none' | 'connecting' | 'connected' | 'disconnected' | 'connectionFailed'
  //   isWearing?: boolean      // put-on / take-off detection
  //   batteryLevel?: number    // 0–100
  //   isCharging?: boolean
  //   isInCase?: boolean
  // }
})
```

### Wearing detection

`isWearing` fires on put-on and take-off — useful for pausing content, logging session times, or triggering UI state changes when the user removes the glasses.

### What's not available

- Raw BLE RSSI or signal strength
- Firmware version
- Individual charging current / power state beyond boolean
- Pairing management

---

## 5. User Info

```typescript
const user = await bridge.getUserInfo()
// UserInfo:
// {
//   uid: number       // numeric user ID in the Even ecosystem
//   name: string      // display name
//   avatar: string    // avatar image URL
//   country: string   // country code
// }
```

> **Privacy note:** User info is only accessible if the user has consented to share it via the Even Realities app. The `uid` is an Even-ecosystem ID, not a phone ID or email.

### What's not available

- Email address
- Phone number / contacts
- Social graph
- Purchase/payment data
- Health profile

---

## 6. Geolocation

Geolocation is **not** a glasses-level sensor — it runs in the phone's WebView via the standard Web API. The Even Realities iOS app holds a location permission (required for BLE scanning on iOS 13+), so `navigator.geolocation` works inside the WebView without extra app-level prompts.

### Requires `app.json` permission

```json
{ "name": "location", "desc": "Shows nearby points of interest." }
```

### Usage

```typescript
navigator.geolocation.getCurrentPosition(pos => {
  const { latitude, longitude, accuracy } = pos.coords
  const speed   = pos.coords.speed   ?? 0   // null when stationary
  const heading = pos.coords.heading ?? 0   // null when stationary or speed = 0
})

navigator.geolocation.watchPosition(pos => { /* streaming */ })
```

### Caveats

- `coords.speed` and `coords.heading` are `null` when the device is stationary or the GPS can't calculate them — always guard with `?? 0`.
- Background geolocation follows iOS/Android WebView suspend rules (see §10).
- No direct API to the GPS hardware on the glasses; everything goes through the phone.

---

## 7. Networking

The app is a WebView. All standard web networking works subject to two independent gates:

| Gate | Who enforces | What it blocks |
|---|---|---|
| `app.json` network whitelist | Even Realities App | Any domain not listed is blocked before the request leaves |
| CORS | iOS WKWebView / Android Chromium | Responses without correct `Access-Control-Allow-Origin` |

### Declaring network access

```json
"permissions": [
  {
    "name": "network",
    "desc": "Fetches weather and reverse-geocoding data.",
    "whitelist": [
      "https://api.weather.com",
      "https://nominatim.openstreetmap.org"
    ]
  }
]
```

- Full origins only — no wildcards, no bare hostnames.
- HTTPS in production; plain `http://` only for local LAN dev.

### Supported transports

| Transport | Works | Notes |
|---|---|---|
| `fetch()` | Yes | Both origins must clear whitelist + CORS |
| `XMLHttpRequest` | Yes | Same rules |
| WebSocket (`ws://`, `wss://`) | Yes | Same whitelist rules; expect drops on Android background |
| Push notifications | No | Plugins are foreground-only |
| Background requests | No | WebView suspended on background; in-flight requests stall |

---

## 8. Display

The glasses render a **container-based canvas**, not HTML. There is no DOM, no CSS, no layout engine.

### Canvas

| Property | Value |
|---|---|
| Size | 576 × 288 px per eye |
| Color | 4-bit greyscale (16 shades of green) |
| Origin | Top-left (0,0); X right, Y down |
| Background | Always black (off pixels are transparent) |

### Container limits

| Type | Max per page |
|---|---|
| Text containers | 8 |
| Image containers | 4 |
| List containers | counted in "other" (up to 8 total) |
| **Total** | **12** |

Exactly **one** container per page must have `isEventCapture: 1`.

### Container types

#### Text

Plain text, left/top-aligned, single fixed-size font, wraps at container width. No font control.

| Limit | Value |
|---|---|
| Max chars (`createStartUpPageContainer`) | 1,000 |
| Max chars (`textContainerUpgrade`) | 2,000 |
| Full-screen capacity | ~400–500 characters |

Update in-place (no flicker): `bridge.textContainerUpgrade()`

#### Image

4-bit greyscale bitmaps. Sent separately after page creation.

| Limit | Value |
|---|---|
| Max width | 288 px |
| Max height | 144 px |
| Formats | `number[]`, `Uint8Array`, `ArrayBuffer`, base64 string |
| Concurrent sends | Not allowed — wait for each to resolve |

#### List

Native scrollable list with firmware-handled selection highlighting.

| Limit | Value |
|---|---|
| Max items | 20 |
| Max chars per item | 64 |
| Per-item styling | None |
| In-place update | Not supported — requires full page rebuild |

### Font and Unicode

Single LVGL font baked into firmware. No font selection, no size control, not monospace. Glyphs outside the set are silently dropped.

Reliable UI characters:
- Progress: `━ ─ █▇▆▅▄▃▂▁`
- Navigation: `▲ △ ▶ ▷ ▼ ▽ ◀ ◁`
- Selection: `● ○ ■ □ ★ ☆`
- Borders: `╭ ╮ ╯ ╰ │ ─`

Full glyph table: https://github.com/nickustinov/even-g2-notes/blob/main/G2.md

---

## 9. Storage

All storage is sandboxed per `package_id`. No cross-app data sharing.

| API | Survives suspend | Survives reinstall | Notes |
|---|---|---|---|
| `bridge.setLocalStorage` / `getLocalStorage` | Yes | No (cleared on uninstall) | Simple key/value string store |
| `window.localStorage` | Yes (iOS); maybe (Android) | No | Standard Web API |
| `IndexedDB` | Yes | No | Quotas not documented — treat as best-effort |
| `OPFS` (Origin Private File System) | Yes | No | Quotas not documented |

> On Android, in-memory state (non-`localStorage`) **may be lost** if the WebView is suspended under memory pressure. Always persist critical state eagerly.

---

## 10. Lifecycle Events

All lifecycle events arrive via `bridge.onEvenHubEvent(event => event.sysEvent)`.

| `OsEventTypeList` | Value | Meaning |
|---|---|---|
| `FOREGROUND_ENTER_EVENT` | 4 | App came to foreground |
| `FOREGROUND_EXIT_EVENT` | 5 | App went to background |
| `ABNORMAL_EXIT_EVENT` | 6 | Unexpected exit (crash, force-stop) |
| `SYSTEM_EXIT_EVENT` | 7 | Normal system-initiated exit |
| `IMU_DATA_REPORT` | 8 | IMU data in `sysEvent.imuData` |

### Launch source

```typescript
bridge.onLaunchSource(source => {
  // source: 'appMenu' | 'glassesMenu'
  // fires once at load, not on reload
})
```

### Exit behavior

- **Root page:** must call `bridge.shutDownPageContainer(1)` — shows system exit dialog. Calling `0` or using a custom exit UI is QA-rejected.
- **Internal pages:** `bridge.shutDownPageContainer(0)` for immediate exit is acceptable.

### Background/foreground survival

| Platform | WebView behavior | WebSocket | Audio capture |
|---|---|---|---|
| iOS | Keeps running cleanly | Typically holds | Keeps streaming |
| Android | May be suspended under memory pressure | Typically dropped | Stops if suspended |

---

## 11. Permissions Reference

Declare in `app.json` as an array of objects (not a key-value map).

| Permission name | What it unlocks | Notes |
|---|---|---|
| `network` | `fetch()`, WebSocket to whitelisted origins | Requires `whitelist` array of full origins |
| `location` | `navigator.geolocation` in WebView | Inherits phone's location grant |
| `g2-microphone` | G2 glasses 4-mic PCM stream via `audioControl()` | 16kHz mono PCM |
| `phone-microphone` | Phone mic | Separate from glasses mic |
| `album` | User's photo library | Not yet detailed in public docs |
| `camera` | Phone camera | G2 has no camera itself |

```json
"permissions": [
  { "name": "network",       "desc": "Fetches weather.", "whitelist": ["https://api.weather.com"] },
  { "name": "location",      "desc": "Shows nearby POI." },
  { "name": "g2-microphone", "desc": "Voice commands." }
]
```

---

## 12. What the SDK Does NOT Expose

These are confirmed absent from the public plugin SDK. Some are roadmap items.

| Capability | Status |
|---|---|
| Raw Bluetooth / BLE access | Not available |
| Camera (G2 has none) | Not applicable — no hardware |
| Speaker / audio output | Not available — no speaker on G2 |
| Haptic feedback | Not available — no actuator |
| Heart rate, SpO2, steps, sleep | Not available — no health sensors |
| Compass / magnetometer | Not exposed (may exist in hardware) |
| IMU units / calibrated orientation | **TBD** — raw X/Y/Z floats only |
| Per-microphone capture / DOA angle | **Roadmap** — currently mono only |
| Arbitrary pixel drawing | Not available — container model only |
| Custom fonts | Not available — fixed firmware font |
| Background network calls | Not available — WebView suspends |
| Push notifications to glasses | Not available — foreground-only |
| Deep links to system browser | **TBD** |
| Paid app distribution | **TBD** |
| Cross-app storage | Not available — strict package_id sandbox |
| File system / media library | Not available |
| Internationalization API | **TBD** — use `bridge.getDeviceInfo()` locale field for now |

---

## 13. Connectivity Architecture

Understanding why limits exist:

```
G2 Glasses  ──BLE 5.2──▶  Even Realities iPhone App
                                    │
                              WebView (your plugin)
                                    │
                              bridge.onEvenHubEvent()
                                    │
                              Your TypeScript code
                                    │
                              fetch() / WebSocket
                                    │
                          Internet (whitelisted only)
```

- The glasses are a **render target + input device** — all compute runs on the phone.
- The app state lives in the WebView on the phone; the glasses display and receive input.
- BLE bandwidth between glasses and phone is ~10–30 KB/s — design image updates accordingly.
- There is no way to run code on the glasses directly.

---

## 14. Known SDK Quirks

| Quirk | Detail |
|---|---|
| `CLICK_EVENT = 0` | Protobuf omits zero-value fields. Single tap arrives as `event.textEvent?.eventType === undefined`. Always coerce: `const t = event.textEvent?.eventType ?? 0` |
| `borderRdaius` typo | The SDK property is misspelled. Use `borderRdaius`, not `borderRadius`, for rounded corners |
| `createStartUpPageContainer` is one-shot | Call exactly once. Subsequent calls no-op. Use `textContainerUpgrade` for all updates |
| Image: second call required | After `createStartUpPageContainer`, push image bytes separately via `updateImageRawData` |
| No concurrent image sends | Wait for one `updateImageRawData` to resolve before sending the next |
| Scroll debounce | Rapid swipes queue up. Apply ~300ms throttle to scroll handlers |
| `isEventCapture` required | Exactly one container per page must be `1`. Missing it silently drops all input |
| Double-click: check both envelopes | `DOUBLE_CLICK_EVENT` can appear in either `sysEvent` or `textEvent` |

---

*Last updated: 2026-06-22. Source docs: `even-realities-docs/` (mirror of hub.evenrealities.com/docs, fetched 2026-06-15).*
