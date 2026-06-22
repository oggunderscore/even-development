# Even Hub SDK API Reference
> Extracted from `@evenrealities/even_hub_sdk@0.0.10` type definitions

## Entry Point

```typescript
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
const bridge = await waitForEvenAppBridge()
```

`waitForEvenAppBridge()` returns a singleton `EvenAppBridge` once the WebView → phone bridge is initialized.

---

## Bridge Methods

### Display

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `createStartUpPageContainer` | `(container: CreateStartUpPageContainer)` | `Promise<StartUpPageCreateResult>` | **One-shot.** Call exactly once at startup. |
| `rebuildPageContainer` | `(container: RebuildPageContainer)` | `Promise<boolean>` | Full layout change — causes flicker. |
| `textContainerUpgrade` | `(container: TextContainerUpgrade)` | `Promise<boolean>` | Preferred update method. No flicker. |
| `updateImageRawData` | `(data: ImageRawDataUpdate)` | `Promise<ImageRawDataUpdateResult>` | Call separately after initial page load. |
| `shutDownPageContainer` | `(exitMode?: number)` | `Promise<boolean>` | exitMode 0=immediate, 1=user-confirm prompt. |

### Device Info

| Method | Signature | Returns |
|--------|-----------|---------|
| `getUserInfo` | `()` | `Promise<UserInfo>` |
| `getDeviceInfo` | `()` | `Promise<DeviceInfo \| null>` |

### Storage

| Method | Signature | Returns |
|--------|-----------|---------|
| `setLocalStorage` | `(key: string, value: string)` | `Promise<boolean>` |
| `getLocalStorage` | `(key: string)` | `Promise<string>` |

### Hardware

| Method | Signature | Returns | Notes |
|--------|-----------|---------|-------|
| `audioControl` | `(isOpen: boolean)` | `Promise<boolean>` | Opens/closes mic. Requires `microphone` permission. |
| `imuControl` | `(isOpen: boolean, reportFrq?: ImuReportPace)` | `Promise<boolean>` | Enables IMU data. Default pace P100. |

### Event Subscriptions (all return `unsubscribe: () => void`)

| Method | Callback Signature |
|--------|--------------------|
| `onLaunchSource` | `(source: LaunchSource) => void` |
| `onDeviceStatusChanged` | `(status: DeviceStatus) => void` |
| `onEvenHubEvent` | `(event: EvenHubEvent) => void` |

---

## Container Types

### TextContainerProperty
```typescript
{
  containerID: number       // unique ID per container
  containerName: string     // human-readable name
  xPosition: number         // px from left (0-576)
  yPosition: number         // px from top (0-288)
  width: number             // px
  height: number            // px
  content: string           // text to display
  isEventCapture: 0 | 1    // exactly ONE container per page must be 1
  borderWidth?: number
  borderColor?: number
  borderRadius?: number     // NOTE: SDK has typo 'borderRdaius' in some versions
  paddingLength?: number
}
```

### ImageContainerProperty
```typescript
{
  containerID: number
  containerName: string
  xPosition: number
  yPosition: number
  width: number    // 20–288 px
  height: number   // 20–144 px
}
```

### ListContainerProperty
```typescript
{
  containerID: number
  containerName: string
  xPosition: number; yPosition: number
  width: number; height: number
  borderWidth?: number; borderColor?: number; borderRadius?: number
  paddingLength?: number
  isEventCapture?: 0 | 1
  itemContainer?: ListItemContainerProperty
}
```

### ListItemContainerProperty
```typescript
{
  itemCount?: number
  itemWidth?: number
  isItemSelectBorderEn?: 0 | 1
  itemName?: string[]
}
```

### CreateStartUpPageContainer / RebuildPageContainer
```typescript
{
  containerTotalNum: number   // 1–12 total containers
  textObject?: TextContainerProperty[]    // max 8
  imageObject?: ImageContainerProperty[]  // max 4
  listObject?: ListContainerProperty[]
}
```

### TextContainerUpgrade
```typescript
{
  containerID?: number
  containerName?: string
  content?: string
  contentOffset?: number
  contentLength?: number
}
```

### ImageRawDataUpdate
```typescript
{
  containerID?: number
  containerName?: string
  imageData?: number[] | string | Uint8Array | ArrayBuffer
}
```

---

## Event Types

### EvenHubEvent (from `onEvenHubEvent`)
```typescript
type EvenHubEvent = {
  listEvent?: List_ItemEvent    // list selection events
  textEvent?: Text_ItemEvent    // text area tap/scroll events
  sysEvent?: Sys_ItemEvent      // system lifecycle + IMU data
  audioEvent?: { audioPcm: Uint8Array }  // 16kHz mono PCM
  jsonData?: Record<string, any>          // raw payload (debug)
}
```

### OsEventTypeList (event types)
| Enum | Value | Trigger |
|------|-------|---------|
| `CLICK_EVENT` | **0** | Single tap — **arrives as undefined** (protobuf omits 0-values) |
| `SCROLL_TOP_EVENT` | 1 | Swipe up / scroll backward |
| `SCROLL_BOTTOM_EVENT` | 2 | Swipe down / scroll forward |
| `DOUBLE_CLICK_EVENT` | 3 | Double tap |
| `FOREGROUND_ENTER_EVENT` | 4 | App enters foreground |
| `FOREGROUND_EXIT_EVENT` | 5 | App goes to background |
| `ABNORMAL_EXIT_EVENT` | 6 | Unexpected exit |
| `SYSTEM_EXIT_EVENT` | 7 | Normal system-initiated exit |
| `IMU_DATA_REPORT` | 8 | IMU data in `sysEvent.imuData` |

### EventSourceType
| Enum | Value |
|------|-------|
| `TOUCH_EVENT_FORM_DUMMY_NULL` | 0 |
| `TOUCH_EVENT_FROM_GLASSES_R` | 1 |
| `TOUCH_EVENT_FROM_RING` | 2 |
| `TOUCH_EVENT_FROM_GLASSES_L` | 3 |

---

## Data Models

### UserInfo
```typescript
{ uid: number; name: string; avatar: string; country: string }
```

### DeviceStatus
```typescript
{
  sn: string                    // serial number (read-only)
  connectType: DeviceConnectType
  isWearing?: boolean
  batteryLevel?: number         // 0–100
  isCharging?: boolean
  isInCase?: boolean
}
```

### DeviceConnectType
`none | connecting | connected | disconnected | connectionFailed`

### DeviceInfo
```typescript
{ model: DeviceModel; sn: string; status: DeviceStatus }
```

### DeviceModel
`g1 | g2 | ring1`

### IMU_Report_Data
```typescript
{ x?: number; y?: number; z?: number }
```

### ImuReportPace
`100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000` (ms intervals)

---

## Result Enums

### StartUpPageCreateResult
| Value | Meaning |
|-------|---------|
| `0` (success) | OK |
| `1` (invalid) | Bad container config |
| `2` (oversize) | Too many containers |
| `3` (outOfMemory) | Device memory full |

### ImageRawDataUpdateResult
`success | imageException | imageSizeInvalid | imageToGray4Failed | sendFailed`

---

## LaunchSource
`'appMenu' | 'glassesMenu'` — fired once at load, not on reload.

---

## Critical Quirks

1. **CLICK_EVENT = 0** — protobuf omits zero fields. Tap arrives as `undefined`. Always use `?? 0`:
   ```typescript
   const type = event.textEvent?.eventType ?? 0  // 0 = CLICK
   ```

2. **`createStartUpPageContainer` is one-shot** — never call it twice. Use `textContainerUpgrade` for updates.

3. **`isEventCapture`** — exactly one container per page must be `1`.

4. **Images need a second call** — after initial page create, call `updateImageRawData()` separately.

5. **Scroll debounce** — apply ~300ms throttle to `onEvenHubEvent` scroll handlers to avoid queue buildup.

6. **SDK typo** — some versions expose `borderRdaius` (not `borderRadius`) on container properties.

7. **Double-click detection** — check both `sysEvent` and `textEvent` envelopes:
   ```typescript
   const isDblClick =
     event.sysEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
     event.textEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
   ```
