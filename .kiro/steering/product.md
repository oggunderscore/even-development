# Product: APPS Bridge

APPS Bridge is a companion phone app (Android + iOS) that runs a local server on the user's phone to relay sensor and media data to AR glasses and other HUD clients made by homeauto.cc.

## What It Does

- Collects GPS, media playback state, and navigation turn-by-turn data from the phone
- Serves that data over a local HTTP API (port 7070) and WebSocket (port 7071) to connected HUD apps (MotoHUD, CC Live, etc.)
- Bridges phone audio capture and live captions to connected clients
- Manages Android foreground service lifecycle based on which components are actively requested

## Key Concepts

- **Component-driven architecture**: Clients send a `client_hello` declaring which bridge components they need (gps, media, nav, http, captions, phone_audio). The bridge activates only requested components.
- **Client apps**: MotoHUD (motorcycle AR HUD), CC Live (closed-caption streaming)
- **Even Toolkit**: The phone UI is themed to match Even Toolkit design tokens used across the G2ToTP and MotoHUD2 apps.
- **Flipper Zero bridge** (iOS only): BLE relay for mirroring Flipper screen to Even G2 glasses.

## Versioning

- Version tracked in `companion-version.json` and the Android `app/build.gradle`
- APK hosted on GitLab at `gitlab.com/homeauto.cc/appsbridge`
