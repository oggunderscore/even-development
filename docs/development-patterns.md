# Even Hub G2 — Development Patterns & Gotchas

## Project Structure

```
app.json         — manifest (package_id, permissions, network whitelist)
index.html       — WebView shell
src/main.ts      — entry point (bridge init, event loop)
src/hud.ts       — display layout + textContainerUpgrade calls
vite.config.ts   — dev server: host 0.0.0.0, port 5173
```

## Startup Sequence

```typescript
const bridge = await waitForEvenAppBridge()   // must be first

// Call createStartUpPageContainer EXACTLY ONCE
const result = await bridge.createStartUpPageContainer(...)
if (result !== 0) { /* handle error */ }

// All subsequent display updates use textContainerUpgrade (no flicker)
await bridge.textContainerUpgrade({ containerID: 1, content: 'new text' })
```

`createStartUpPageContainer` is **one-shot**. Calling it again after the page is live has no effect. Use `textContainerUpgrade` for all updates.

## Event Routing

```typescript
bridge.onEvenHubEvent((event) => {
  // sysEvent  → taps, double-taps, lifecycle
  // textEvent → scroll up/down
  // audioEvent → mic PCM chunks

  const sysType  = event.sysEvent?.eventType  ?? -1
  const textType = event.textEvent?.eventType ?? 0   // 0 = CLICK_EVENT (PB omits zero)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer()
  }
})
```

**Known quirk:** `CLICK_EVENT = 0` — protobuf omits zero-value fields on the wire.  
A tap arrives as `event.textEvent?.eventType === undefined`. The `?? 0` coercion fixes this.

## Container Rules

- `containerTotalNum` must equal the number of containers you declare
- Exactly **one** container must have `isEventCapture: 1`
- Max **8 text** containers, **4 image** containers, **12 total**
- Container IDs must be unique positive integers

## SDK Typo

The border-radius property is **misspelled** in the SDK: `borderRdaius` (not `borderRadius`). If you need rounded corners, use the typo.

## Scroll Throttling

Rapid swipes queue up requests. Debounce scroll handlers:

```typescript
let lastScrollAt = 0
if (Date.now() - lastScrollAt > 300) {
  lastScrollAt = Date.now()
  // handle scroll
}
```

## Image Containers

After initial page load, push image bytes with a **second** call:

```typescript
await bridge.createStartUpPageContainer(...)
await bridge.updateImageRawData({ containerID: 5, imageData: pixelArray })
```

## Lifecycle Cleanup

Always unsubscribe and release resources on exit:

```typescript
const unsub = bridge.onEvenHubEvent((event) => {
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsub()
    stopBackgroundWork()
  }
})
window.addEventListener('beforeunload', () => { unsub(); stopBackgroundWork() })
```

## Development Workflow

```bash
npm run dev          # start Vite on :5173
npm run simulator    # launch Even Hub desktop simulator
npm run qr           # generate sideload QR (needs LAN IP, not localhost)
npm run build        # tsc + vite build → dist/
npm run pack         # build + evenhub pack → evenpilot.ehpk
```

For QR sideloading with explicit IP:
```bash
npx evenhub qr --url "http://192.168.x.x:5173"
```

## Geolocation in WebView

`navigator.geolocation` works in the Even Hub WebView because the Even Realities iOS app holds location permission (required for BLE scanning on iOS 13+). No extra permissions needed beyond `"location"` in `app.json`.

GPS fields that can be `null`:
- `coords.speed` — null when stationary or GPS can't calculate it
- `coords.heading` — null when stationary or speed is 0

Always guard: `pos.coords.speed ?? 0`.
