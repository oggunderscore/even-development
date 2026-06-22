# Bridge Structure for Future Apps

## Goal

Make APPS Bridge component-driven instead of app-driven.

Future apps should connect, declare what they need, and let the bridge activate only those components.

## Current Model

Today the bridge mostly works like this:

```text
MotoHUD connected -> start GPS + HTTP + media/nav
CC Live connected -> handle caption/audio commands
```

This works, but it hard-codes behavior around specific apps.

## Recommended Model

Future apps should send a `client_hello` message that declares required components:

```json
{
  "type": "client_hello",
  "app": "motohud",
  "name": "MotoHUD",
  "version": "1.2.0",
  "components": ["gps", "media", "nav"],
  "transport": ["websocket"]
}
```

Another app could request different components:

```json
{
  "type": "client_hello",
  "app": "cc_live",
  "name": "CC Live",
  "components": ["captions", "phone_audio"]
}
```

The bridge should calculate the union of all connected client requests:

```text
Client A wants gps + nav
Client B wants media
Client C wants captions

Active bridge components = gps + nav + media + captions
```

When a client disconnects, the bridge recalculates and stops anything no longer needed.

## Suggested Components

```text
gps         -> GpsManager
media       -> media session refresh
nav         -> navigation notification scan
http        -> legacy REST/SSE server on 7070
captions    -> caption status/events over WebSocket
phone_audio -> PhoneAudioCaptureService
```

WebSocket should be the default future transport. HTTP should stay available as a compatibility component for older apps.

## Android Service Rule

Foreground service state should follow active components:

```text
No active components -> standby or release foreground
GPS active -> foreground service type location
Phone audio active -> mediaProjection foreground service
Only WebSocket connected -> short bootstrap foreground, then standby if nothing requested
```

## Clean Code Shape

`WsServer` should handle protocol and client tracking:

```text
WebSocket connects
Parse client_hello
Store requested components per client
Notify BridgeService when the component set changes
```

`BridgeService` should own lifecycle decisions:

```text
Requested components changed
Promote foreground if needed
Start newly required components
Stop components no longer required
Update notification
Release foreground if idle
```

Suggested internal model:

```kotlin
enum class BridgeComponent {
    GPS,
    MEDIA,
    NAV,
    HTTP,
    CAPTIONS,
    PHONE_AUDIO
}

data class ClientRequest(
    val app: String,
    val name: String,
    val components: Set<BridgeComponent>
)
```

## Migration Path

1. Keep existing MotoHUD fallback behavior.
2. Add `components` support to `client_hello`.
3. If `components` is missing, use compatibility defaults:

```text
motohud -> gps + media + nav + http
live_cc -> captions
```

4. Replace `onActiveModuleChanged()` with `onRequestedComponentsChanged()`.
5. Split media and navigation activation later if finer control is needed.

## Summary

Future apps should not require bridge code changes just to turn on GPS, media, nav, captions, or other capabilities.

Apps declare components. The bridge activates components. Android foreground behavior follows the active components.
