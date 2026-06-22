# Tech Stack

## Android Companion (`companion-android/`)

- **Language**: Kotlin
- **Min SDK**: 26 (Android 8.0) / **Target SDK**: 34
- **Build System**: Gradle (AGP 8.7.3, Kotlin 2.0.21)
- **JVM Target**: 1.8
- **Key Libraries**:
  - `androidx.core:core-ktx:1.12.0`
  - `androidx.appcompat:appcompat:1.6.1`
  - `com.google.android.material:material:1.11.0`
  - `org.nanohttpd:nanohttpd:2.3.1` — lightweight HTTP server
  - `org.java-websocket:Java-WebSocket:1.5.3` — WebSocket server
- **UI**: Native Android XML layouts + Material components, themed with Even Toolkit tokens
- **No Compose, no Jetpack Navigation, no DI framework**

## iOS Companion (`companion-ios/`)

- **Language**: Swift 5.9
- **Platform**: iOS 16.0+
- **Build**: Xcode 15, project generated via XcodeGen (`project.yml`)
- **CI**: Codemagic (`codemagic.yaml`)
- **UI**: SwiftUI
- **No SPM dependencies** — uses only Apple frameworks (CoreLocation, CoreBluetooth, Network, MediaPlayer)

## Common Build Commands

### Android

```bash
# Build debug APK
cd companion-android && ./gradlew assembleDebug

# Build release APK
cd companion-android && ./gradlew assembleRelease
```

### iOS

```bash
# Generate Xcode project from project.yml
cd companion-ios && xcodegen generate

# Build via xcodebuild
cd companion-ios && xcodebuild -project AppsBridge.xcodeproj -scheme AppsBridge -sdk iphoneos build
```

## No Test Framework

There is currently no test suite or test framework configured for either platform.
