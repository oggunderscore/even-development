# Project Structure

```
appsbridge-main/
├── companion-android/          # Android companion app (Kotlin)
│   ├── app/
│   │   ├── build.gradle        # App-level Gradle config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       ├── java/cc/homeauto/appsbridge/
│   │       │   ├── BridgeComponent.kt      # Component enum + ClientRequest model
│   │       │   ├── BridgeServer.kt         # NanoHTTPD REST/SSE server (port 7070)
│   │       │   ├── BridgeService.kt        # Android foreground service; lifecycle owner
│   │       │   ├── GpsManager.kt           # GPS location listener
│   │       │   ├── LiveCaptionModels.kt    # Caption data models
│   │       │   ├── MainActivity.kt         # Phone UI activity
│   │       │   ├── MediaListener.kt        # Media session + notification listener
│   │       │   ├── NavIcons.kt             # Navigation icon assets
│   │       │   ├── NavResolver.kt          # Turn instruction → icon type mapping
│   │       │   ├── PhoneAudioCapture.kt    # Audio capture logic
│   │       │   ├── PhoneAudioCaptureService.kt
│   │       │   ├── SharedState.kt          # Global mutable state (volatile fields)
│   │       │   ├── SpeechToTextEngine.kt   # On-device STT
│   │       │   ├── StartBridgeActivity.kt  # Intent-based bridge start
│   │       │   ├── UpdateChecker.kt        # OTA version check
│   │       │   └── WsServer.kt             # WebSocket server (port 7071); protocol handler
│   │       ├── res/
│   │       │   ├── drawable/               # Even Toolkit themed shapes/backgrounds
│   │       │   ├── layout/                 # XML layouts
│   │       │   ├── values/                 # Colors, dimens, strings (light)
│   │       │   └── values-night/           # Dark theme overrides
│   │       └── assets/
│   │           └── third_party_licenses.txt
│   ├── build.gradle            # Root Gradle (plugin versions)
│   ├── settings.gradle
│   └── THEME_PORT.md           # Even Toolkit porting credit/reference
│
├── companion-ios/              # iOS companion app (Swift/SwiftUI)
│   ├── AppsBridge/
│   │   ├── AppsBridgeApp.swift       # App entry point
│   │   ├── AppViewModel.swift        # UI state
│   │   ├── BridgeServer.swift        # HTTP server
│   │   ├── BridgeService.swift       # Service coordinator (singleton)
│   │   ├── BridgeState.swift         # Observable state
│   │   ├── ContentView.swift         # Main SwiftUI view
│   │   ├── FlipperBleClient.swift    # Flipper Zero BLE
│   │   ├── FlipperBridgeService.swift
│   │   ├── FlipperRpc.swift
│   │   ├── FlipperState.swift
│   │   ├── FlipperWsServer.swift
│   │   ├── LocationManager.swift     # CoreLocation wrapper
│   │   └── MediaManager.swift        # Now Playing info
│   ├── project.yml             # XcodeGen project definition
│   └── codemagic.yaml          # CI config
│
├── BRIDGE_FUTURE_APPS.md       # Architecture roadmap (component-driven model)
├── CHANGELOG.md                # Release notes (keep updated)
├── companion-version.json      # Current version + APK download URL
├── rules.md                    # Project rules (changelog, theming, credits)
└── appsbridge.apk             # Latest release APK artifact
```

## Architecture Patterns

- **Android**: Single foreground `Service` (`BridgeService`) owns all component lifecycle. `WsServer` handles WebSocket protocol and client tracking. `SharedState` is a volatile-field singleton for cross-thread state.
- **iOS**: `BridgeService.shared` singleton coordinates server, location, and media managers. SwiftUI observes `BridgeState`.
- **Protocol**: Clients connect via WebSocket, send `client_hello` with requested components, receive push frames `{"type":"gps"|"media"|"nav", "data":{...}}`.
- **State flow (Android)**: `WsServer` → `onRequestedComponentsChanged` → `BridgeService.applyRequestedComponents` → starts/stops GPS, HTTP, media, nav, captions, audio.

## Conventions

- All changelog entries go under `## Unreleased` during development.
- Android theme ports credit the `even-toolkit` npm package author and reference the source token file.
- Prefer existing project patterns; do not introduce new libraries or frameworks without justification.
