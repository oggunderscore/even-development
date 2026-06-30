# Flipper-Zero-on-G2-Glasses

A Bluetooth bridge that mirrors a Flipper Zero's screen onto Even Realities G2
glasses and lets the user drive the Flipper's d-pad via temple-touch gestures
on the glasses.

## Validation status (read this first)

| Path                                                                   | Status |
|------------------------------------------------------------------------|--------|
| Flipper → Android bridge (real BLE) → desktop **simulator**            | ✅ validated on hardware (one Flipper, fw 0.103.1) |
| Flipper → Python USB bridge → desktop **simulator**                    | ✅ validated |
| `npm run build` + `evenhub pack` → valid `.ehpk`                       | ✅ validated |
| Webapp running in the **real Even WebView** on a phone                 | ✅ **verified on real glasses (2026-06-10, QR dev-server sideload)** |
| Loopback `ws://127.0.0.1:9876` from the real Even WebView (sideloaded)  | ✅ **verified — the WebView reaches the bridge's loopback socket** |
| Flipper screen rendering on **real G2 glasses** (phone→glasses BLE hop) | ✅ **verified end-to-end** |
| Same loopback for an Even Hub **production** (.ehpk) install            | ❌ untested — production may require HTTPS; cleartext `ws://` could be rejected |
| Real temple-touch gestures driving the Flipper                         | ⚠️ to confirm on hardware (worked in simulator) |
| `.ehpk` install via Even dev portal (standalone, no dev server)        | ❌ not attempted |

The make-or-break unknown — whether the Even WebView could reach a separate
app's loopback WebSocket on-device — is **resolved: it works** (verified
2026-06-10 via the QR dev-server sideload). The remaining open items are the
standalone `.ehpk`/portal install (where the cleartext-`ws://` production rule
may bite) and on-hardware input/latency tuning.

## Architecture (desktop development)

```
Flipper Zero
   │  BLE GATT (Flipper RPC protobuf)
   ▼
Android phone running flipper-bridge.apk   (WebSocket on phone 127.0.0.1:9876)
   │  USB tunnel: `adb forward tcp:9876 tcp:9876`   <-- desktop-only shim
   ▼
g2-starter webapp in evenhub-simulator (desktop)
   │  EvenHub SDK (updateImageRawData / onEvenHubEvent)
   ▼
simulated HUD
```

## Production topology (real glasses — UNVERIFIED)

```
Flipper Zero
   │  BLE GATT
   ▼
Android phone:
   ├── flipper-bridge.apk        (foreground service, WS on 127.0.0.1:9876)
   └── Even companion app
         └── WebView running g2-starter webapp
               │  ws://127.0.0.1:9876   <-- SAME-DEVICE loopback, NO adb forward
               │  EvenHub SDK
               ▼
            phone → G2 glasses over Even's own BLE link   <-- second hop, untested
               ▼
            G2 glasses HUD
```

Key difference from the dev path: in production the webapp and the bridge are
**both on the phone**, so the WebSocket is a same-device loopback and
`adb forward` is NOT used. Whether the Even WebView is allowed to open a
cleartext `ws://127.0.0.1` connection to a separate app is the central
unknown (see Risks).

## Critical first test on real glasses — ✅ PASSED (2026-06-10)

This was the gate for the whole architecture: can code in the Even WebView
reach a separate app's loopback socket on-device? **Yes.** Verified via the
QR dev-server sideload — the webapp loaded in the real Even WebView, connected
to the bridge over `ws://127.0.0.1:9876`, and the Flipper screen rendered on
the glasses.

The procedure that worked (dev/test loop, page served live from a dev server):

1. Install `flipper-bridge.apk` on the phone, pair the Flipper, **Start bridge** → READY.
2. Point the phone at the webapp dev server. Tethered to a dev machine over
   USB: `adb reverse tcp:5173 tcp:5173`, then `evenhub qr --url http://127.0.0.1:5173 --http`.
3. Scan the QR with the Even Realities app. The webapp loads in the WebView
   (hot-reload), and its `ws://127.0.0.1:9876` reaches the bridge **on the
   phone** (no `adb forward` — that connection is phone-local).

Note this dev flow does **not** install a standalone app — it loads a live URL
for the session. A real installed app needs the `.ehpk` via the Even dev
portal (still untested; may hit the cleartext-`ws://` production rule).

**Update — per the official networking guide
(hub.evenrealities.com/docs/guides/networking):** WebSockets are supported,
and *"Plain http:// is only useful for local dev (e.g. when sideloaded
against a LAN dev server)."* So cleartext loopback is explicitly allowed for
**sideloaded** builds — the test above will very likely pass. The catch is
production: *"HTTPS is required in production"* and the `network` permission
takes a `whitelist` of full HTTPS origins (no wildcards, no bare hostnames,
unused entries flagged in review). The cleartext-loopback approach is fine
for sideloaded use but **cannot ship through Even Hub** without a TLS rework
(see Risks → Distribution).

For desktop development the glasses+EvenHub WebView is replaced by
`evenhub-simulator` (`npm i -g @evenrealities/evenhub-simulator`).

## Display variants

The webapp HUD layout has two implementations:

- **Single container (current, on `main`):** one **288×144** image container,
  centered. The display guide lists 200×100 as the max, but a firmware update
  raised it to 288×144 (matching the bundled `.d.ts`). 128×64 → 288×144 is a
  clean 2.25× upscale at Flipper's exact 2:1 aspect — no letterboxing, no
  tiling complexity. Code in `g2-starter/src/render.ts` (`RenderQueue` /
  `makeBridgeRenderQueue`) + `main.ts`.
- **Tiled (experimental, on branch `tiled-display`):** a 2×2 grid of four
  200×100 containers (400×200 total) with per-tile dedup. Built before the
  288×144 limit was known; kept for reference but not used — the single
  288×144 container is simpler and sends ~1× the data instead of up to 4×.
  `git checkout tiled-display` to try it.

## Components

### `linux-bridge/` — Python reference bridge
- Talks to a Flipper over **USB-CDC serial** (`/dev/ttyACM0`)
- Same WebSocket contract as the Android bridge
- Mostly used as a working reference and for development on the desktop without
  a phone in the loop
- Generated Flipper protobuf bindings in `pb/`; source `.proto` files vendored
  in `proto-src/` from `flipperdevices/flipperzero-protobuf`

### `flipper-bridge/` — Android bridge app (production target)
- Kotlin, Gradle Kotlin DSL, AGP 8.x, min SDK 26, target SDK 34
- BLE GATT client → Flipper RPC over BLE (UUIDs from
  `targets/f7/ble_glue/services/serial_service_uuid.inc`)
- Foreground service with embedded Ktor WebSocket server on `127.0.0.1:9876`
- Auto-connects to any bonded "Flipper *" device on bridge start
- Build: `./gradlew assembleDebug` then `adb install -r
  app/build/outputs/apk/debug/app-debug.apk`
- Stub mode: set `BuildConfig.USE_STUB=true` in `app/build.gradle.kts` to
  emit fake frames without a real Flipper (useful in an Android emulator)

### `g2-starter/` — Glasses webapp
- Vite + TypeScript, Even Realities SDK
- `src/flipper-client.ts` — typed WebSocket client with exponential-backoff
  reconnect
- `src/render.ts` — `RenderQueue` with time-based dispatch throttle (UDP-style
  drop-old-pending) and PNG encoding via `OffscreenCanvas`
- `src/input.ts` — maps glasses temple gestures to button messages
- `src/main.ts` — boot: create image + text containers, wire client + render
  queue + input router
- Bridge URL configurable via `VITE_BRIDGE_URL` env var
- Dispatch interval configurable via `VITE_MIN_DISPATCH_MS` env var

## WebSocket protocol

URL: `ws://127.0.0.1:9876/ws`. JSON text frames.

Server → client:
- `{"type":"status","state":"scanning"|"connected"|"disconnected","info":"..."}`
- `{"type":"frame","w":128,"h":64,"bpp":1,"seq":<int>,"data":"<base64 of 1024 bytes, row-major MSB-first>"}`

Client → server:
- `{"type":"connect"}` / `{"type":"disconnect"}`
- `{"type":"button","key":"up|down|left|right|ok|back","action":"short|long|press|release"}`

## How to run end-to-end (Linux desktop dev path)

1. Plug Flipper into desktop USB. Confirm `/dev/ttyACM0` exists and is in the
   `dialout` group (or has `uaccess` ACL from the udev rule installed in
   `/etc/udev/rules.d/42-flipperzero.rules`).
2. `cd linux-bridge && source .venv/bin/activate && python bridge.py` — listens
   on `ws://127.0.0.1:9876/ws`.
3. `cd g2-starter && npm run dev` — Vite on `http://localhost:5173`.
4. `evenhub-simulator http://localhost:5173` — opens the glasses simulator.

## How to run end-to-end (real Android phone + Flipper over BLE)

1. Pair the Flipper in Android Bluetooth settings once (PIN). The bridge app
   will auto-connect to any bonded "Flipper *" device.
2. Install `flipper-bridge.apk` on the phone. Grant Bluetooth and notification
   permissions. Tap **Start bridge** — status walks SCANNING/skipped →
   CONNECTING → DISCOVERING → READY.
3. With phone plugged into the desktop via USB and USB debugging on:
   `adb forward tcp:9876 tcp:9876`
4. `cd g2-starter && npm run dev` + `evenhub-simulator http://localhost:5173`
   on the desktop. The webapp's `127.0.0.1:9876` is now tunneled to the phone.

## Hard-won quirks (don't relitigate without strong evidence)

### Flipper RPC over serial
- The CLI command `start_rpc_session` must be terminated with **`\r` only**.
  `\r\n` makes the CLI interpret the LF as a second empty command, which
  corrupts the first protobuf request silently.
- After `start_rpc_session` there is **no welcome/ack response** — Flipper
  goes silent and is immediately in RPC mode. Don't wait for a banner.
- Test that you're in RPC mode by sending `\r\n`: in CLI mode you'd get a
  prompt echo, in RPC mode you get nothing.

### Flipper input via RPC
- Empirically Flipper apps react to **`PRESS → SHORT → RELEASE`** even though
  per-firmware-doc the natural temporal order is `PRESS → RELEASE → SHORT`.
  We tried the doc order — actions stopped firing. Keep the empirical order.
- A lone `SHORT` event is usually ignored — Flipper's input handler expects
  the full triplet.
- Inter-event delay matters: too tight (<30 ms) → events coalesced; too wide
  (>200 ms) → input feels sluggish. Currently using **60 ms** between events.
- **Cross-key first press is sometimes dropped** (e.g. 4 ups land fine, the
  first down after gets ignored, the second down works). We tried connection
  priority HIGH, wake-pair prefix, doc-order sequence, longer delays — none
  fully fixed it. The official Flipper Android app exhibits the same.

### Android BLE quirks (Samsung & friends)
- `discoverServices()` directly inside `onConnectionStateChange` silently
  hangs on some stacks. Bounce through main thread with a ~600 ms delay.
- `BluetoothGatt.refresh()` (reflection-only) clears stale GATT cache —
  required after replug to avoid empty service list.
- MTU negotiation must come **after** `discoverServices` succeeds, not
  before. Reverse order hangs.
- BLE scan throttle: **5 scans in 30 s → silent 30-min dropout** with no
  error. Workarounds: skip scan entirely when a bonded device exists, or use
  ScanFilter (but Flipper doesn't advertise its 128-bit service UUID, so
  filtering may miss it).
- Pick RX/TX chars by **characteristic properties** (NOTIFY/INDICATE vs
  WRITE), not by UUID name — the "RX" naming is from Flipper's perspective.
- Flipper's notify char on firmware 0.103.x is actually **INDICATE**, not
  NOTIFY. Check the property bits and write the appropriate CCC value.
- `CONNECTION_PRIORITY_HIGH` keeps the link awake (~7.5–15 ms interval) so
  inputs after idle aren't dropped to wake-up timing.
- For TX writes use `WRITE_TYPE_NO_RESPONSE` for throughput (RPC doesn't
  need per-write acks).

### Even Realities display / containers
- HUD canvas is **576×288**, 4-bit greyscale. Up to **4 image containers** and
  8 other containers per page (per the official display guide).
- Image container max size: the display guide says **200×100**, but a firmware
  update raised it to **288×144** (matching the bundled `.d.ts`, which lists
  20–288 / 20–144). We use **288×144** — a clean 2.25× of Flipper's 128×64 at
  the exact 2:1 aspect. The docs are stale here; trust the firmware/`.d.ts`.
- Up to **4 image containers** per page are allowed, so tiling for a larger
  display is possible (see the `tiled-display` branch — a 2×2 200×100 grid).
  Not used: a single 288×144 is simpler and sends ~1× the data vs up to 4×.
- `ImageContainerProperty` does NOT accept `isEventCapture` — only Text/List
  containers do. Official pattern (display guide): a **full-screen text
  container** (576×288) at (0,0) with `content: ' '` and `isEventCapture: 1`
  behind the image. We use exactly that.
- `updateImageRawData` expects an **encoded image** (PNG) not raw pixel
  bytes. The device side does the gray4 conversion internally (the SDK
  README "raw bytes" wording is misleading — see
  `ImageRawDataUpdateResult.imageToGray4Failed`).
- Flutter IPC inside the sim resolves `updateImageRawData` promises before
  actual rendering, so the SDK's natural backpressure doesn't work. We
  enforce a **wall-clock dispatch interval** in `RenderQueue` (3000 ms
  default). Going too low makes the sim's input handler stall (queues build,
  starve event loop).
- HMR reloads accumulate stale `RenderQueue` / `FlipperClient` instances.
  Restart the sim cleanly between iterations if behavior gets weird.
- Inputs occasionally drop silently under sustained PNG decode load even
  when the sim window looks responsive. Restart the sim.
- Console messages: Vite only forwards `console.warn` and `console.error`
  from the sim's WebView back to the dev server log — not `console.log`.

## Tunable knobs

| Knob                                                                       | Default | Trade-off                                  |
|----------------------------------------------------------------------------|---------|--------------------------------------------|
| `BridgeService.MIN_INTERVAL_MS` (Android bridge)                           | 1000 ms | Frame emit cadence over WS                 |
| `BridgeService.routeButton` inter-event delay                              | 60 ms   | Smaller = laggier UI but tight events      |
| `VITE_MIN_DISPATCH_MS` (webapp)                                            | 500 ms  | Smaller = smoother animation, more sim load (2 fps) |
| `linux-bridge/bridge.py` `MIN_INTERVAL`                                    | 0.25 s  | Same as the Android equivalent             |
| Image container size (`main.ts` / `render.ts`)                             | 288×144 | Firmware max (docs say 200×100 but are stale)        |

## What works (simulator only)

- Flipper screen → Android phone (real BLE) → desktop simulator HUD (live,
  ~2 fps under current throttle, faster on static screens which dedup to 0)
- Temple gestures in simulator → Android phone → Flipper d-pad (with caveats
  below; cross-key first-press intermittently drops)
- Auto-reconnect on either end
- Static screens generate no traffic (hash dedup at the bridge)
- `npm run build` passes and `evenhub pack` produces a valid `.ehpk`

## What doesn't / is risky / is unproven

**Distribution — cleartext loopback blocks Even Hub submission:**
- Per the networking guide, **production requires HTTPS**; cleartext `ws://`
  is allowed only for local-dev / sideloaded builds. Our webapp talks to the
  bridge over `ws://127.0.0.1:9876`, so it can be **sideloaded and used** but
  **cannot be submitted to Even Hub** as-is.
- The `network` permission expects a `whitelist` of full HTTPS origins (no
  wildcards/bare hostnames; unused entries flagged in review) — a model built
  for remote API domains, not loopback IPC to a companion app. There is no
  clean way to whitelist a localhost WebSocket for production.
- To ship via Even Hub would require the bridge to serve **`wss://` with a
  cert the WebView trusts** on loopback (awkward), or a fundamentally
  different transport. Sideloading sidesteps all of this.

**Blocking unknowns (need real glasses to answer):**
- **Loopback `ws://127.0.0.1` from the real Even WebView (sideloaded)** — not
  yet tested on hardware, but the networking guide explicitly permits
  cleartext loopback for sideloaded dev builds, so this is now *likely OK*
  rather than a coin-flip. Still the #1 thing to confirm. See "Critical first
  test on real glasses".
- **Real glasses display path** — the phone→glasses BLE hop is untested. Frame
  rate will likely be worse than the simulator and may need a higher
  `VITE_MIN_DISPATCH_MS`. The SDK's "avoid sending images too frequently"
  warning is about THIS link, which the simulator does not model. We ship a
  single 288×144 PNG per frame (~1.5 KB) to keep the per-frame payload small.
- **Real temple-touch gestures** — only the simulator's click widget was
  exercised; real hardware event delivery may differ.

**Known, unsolved issues:**
- Cross-key first-press reliability — not fully solved (official Flipper app
  has the same behavior).
- Simulator input handler can stall silently under load — restart fixes it
  (a real-glasses equivalent of this is unknown).

**Scope limits:**
- Single 288×144 container on `main`; experimental 2×2 tiled (400×200)
  variant on the `tiled-display` branch.
- Two-app UX: user must install the bridge APK separately, pair the Flipper,
  start the bridge service, then launch the webapp. Not a single-app flow.
- Validated against exactly one Flipper (fw 0.103.1).
- `.ehpk` has never been sideloaded or submitted to Even Hub; that process is
  unknown.

## Plan + history

- Implementation plan: `~/.claude/plans/shiny-pondering-journal.md`
- Linux bridge debug scripts (kept for future RPC issues):
  `linux-bridge/debug*.py`
