# flipper-bridge

Native Android app that bridges a Flipper Zero (BLE) to a localhost
WebSocket the Even Realities G2 WebView app can talk to.

The wire protocol and overall design are documented in
`/home/cola/.claude/plans/shiny-pondering-journal.md`.

## Prerequisites

- JDK 17
- Android Studio Iguana (or newer) / Android Gradle Plugin 8.5.x
- A phone running Android 8.0 (API 26) or newer. **Real BLE testing
  requires a physical phone** - Android emulators do not expose BLE
  hardware.

## Open & build

1. In Android Studio: **File -> Open** and pick
   `/home/cola/evenrealities/flipper-bridge`.
2. Let Gradle sync. The wrapper is checked in.
3. Run the `app` configuration on a device or emulator.

If your Gradle wrapper jar is missing for any reason, regenerate it with a
locally-installed Gradle 8.7+: `gradle wrapper --gradle-version 8.7`.

## Modes

`app/build.gradle.kts` exposes a `BuildConfig.USE_STUB` field
(`defaultConfig.buildConfigField`).

- `USE_STUB = false` (default): real BLE - scan for a `Flipper ` device,
  connect, subscribe to the screen stream, broadcast frames over the WS.
- `USE_STUB = true`: skip BLE entirely, emit a synthetic moving-bar frame
  at 2 fps so the glasses webapp can be developed without hardware. Use
  this for emulator runs.

## Runtime UI

- **Start bridge** / **Stop bridge** - controls the foreground service
  hosting `ws://127.0.0.1:9876/ws`.
- **Scan + Connect** - in BLE mode, kicks off a scan and auto-connects to
  the first device whose advertised name starts with `Flipper ` (trailing
  space intentional, that is Flipper's prefix).
- **Disconnect** - drops the BLE link.
- Six manual d-pad buttons - route through `FlipperRpc.sendInputEvent`
  -> `FlipperBleClient.send`, so you can drive the Flipper without the
  glasses webapp at all.
- Status row shows the BLE state, connected device name/MAC/RSSI, and
  the running `frames` / `skips` counters (skips = dedup hits + throttle
  drops).

## WebSocket contract

URL: `ws://127.0.0.1:9876/ws` (no subprotocol, JSON text frames).

Server -> client:

```jsonc
{"type":"status","state":"scanning"|"connected"|"disconnected","info":"<optional>"}
{"type":"frame","w":128,"h":64,"bpp":1,"seq":<int>,
 "data":"<base64 of w*h/8 bytes, row-major, MSB-first within each byte>"}
```

Client -> server:

```jsonc
{"type":"connect"}
{"type":"disconnect"}
{"type":"button","key":"up"|"down"|"left"|"right"|"ok"|"back",
 "action":"short"|"long"|"press"|"release"}
```

## Throttle knob

`BridgeService.MIN_INTERVAL_MS` (default `1000`) caps frame emissions to
~1 fps for changing screens. The Linux reference (`linux-bridge/bridge.py`)
arrived at this value experimentally: faster than ~1 fps starves the
downstream EvenHub SDK's image pipeline (`updateImageRawData` has a "do
not call again while in-flight" rule). Static screens are skipped
entirely via an 8-byte SHA-256 content hash before the throttle check, so
an idle Flipper produces zero traffic.

## Stub-mode smoke test (emulator OK)

```sh
# Run the app with USE_STUB=true on an emulator, then:
adb forward tcp:9876 tcp:9876
wscat -c ws://127.0.0.1:9876/ws
# expect a status frame, then frame frames at 2 fps
> {"type":"button","key":"up","action":"short"}
# expect `adb logcat | grep BridgeService` to show the button line
```

For the glasses webapp running against the bridge from the same host:
```sh
adb reverse tcp:9876 tcp:9876
# now ws://127.0.0.1:9876/ws inside the WebView reaches the phone bridge
```

## Real-BLE smoke test (physical phone required)

1. Sideload the APK on the phone (USB-debugging install or any sideload
   path).
2. Power on the Flipper, ensure BLE pairing is open (default).
3. Open the app, grant `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` /
   `POST_NOTIFICATIONS` prompts.
4. Tap **Start bridge**, then **Scan + Connect**. Status should walk
   through `SCANNING -> CONNECTING -> DISCOVERING -> READY` and the
   device row should show the Flipper name + MAC + RSSI.
5. The bridge sends `gui_start_screen_stream_request` automatically on
   `READY`. The `frames` counter starts climbing whenever the Flipper
   screen changes.
6. Tap the d-pad buttons; the Flipper should react. Each `short` press
   expands to `PRESS -> SHORT -> RELEASE` because Flipper firmware
   0.103.x drops a lone `SHORT` (per the Linux reference).

## Where the GATT UUIDs come from

`FlipperBleClient.kt` constants:

```
SERIAL_SERVICE_UUID = 8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000
TX_CHAR_UUID        = 19ed82ae-ed21-4c9d-4145-228e61fe0000
RX_CHAR_UUID        = 19ed82ae-ed21-4c9d-4145-228e62fe0000
FLOW_CONTROL_UUID   = 19ed82ae-ed21-4c9d-4145-228e63fe0000
RPC_STATUS_UUID     = 19ed82ae-ed21-4c9d-4145-228e64fe0000
```

These are derived from the Flipper firmware source of truth:

<https://github.com/flipperdevices/flipperzero-firmware/blob/dev/targets/f7/ble_glue/services/serial_service_uuid.inc>

The bytes in that file are little-endian (STM Cube BLE-stack convention);
they are reversed in the Kotlin constants to produce the standard
big-endian 128-bit UUID strings. If Flipper firmware ever rotates these,
regenerate from that file.

## Protobuf vendoring

`app/src/main/proto/*.proto` is a verbatim copy of the linux bridge's
`linux-bridge/proto-src/*.proto`, themselves vendored from
<https://github.com/flipperdevices/flipperzero-protobuf>. The
`com.google.protobuf` Gradle plugin generates javalite Java sources at
build time (`protobuf-javalite` runtime); the Kotlin code reaches them
via the `com.flipperdevices.protobuf` / `com.flipperdevices.protobuf.screen`
packages set by `option java_package` in the proto files.
