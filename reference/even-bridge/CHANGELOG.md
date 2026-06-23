# Changelog

## Unreleased

## 1.2.5

- Fixed APPS Bridge phone theme application after the 1.2.3/1.2.4 bridge changes by applying the saved mode locally, restoring system bar colors, and disabling Android force-dark inversion over the custom Even Toolkit token palette.

## 1.2.4

- Added managed MotoHUD lifecycle heartbeats so APPS Bridge clears active component requests when the glasses HUD exits but the phone WebView socket stays open.

## 1.2.3

- Fixed MotoHUD component wake-up so APPS Bridge starts HTTP, media, navigation, and GPS listener attempts even if Android delays foreground-service promotion, then retries foreground/GPS startup and restarts GPS if no first fix arrives while the HUD remains connected.

## 1.2.2

- Changed navigation state so arrival/end-of-route notifications mark navigation inactive immediately, then switch to a friendly "No active Navigation" message after 10 seconds.

## 1.2.1

- Fixed the Android phone UI so opening APPS Bridge after an update, reboot, or process kill no longer starts the bridge service automatically.
- Fixed Android HUD WebSocket wake-up so the first connected client immediately promotes APPS Bridge to a data-sync foreground service, keeps an ongoing notification showing the active HUD, and only enables requested bridge components after foreground promotion succeeds.
- Changed MotoHUD wake-up so the Android service enters location foreground mode before requesting GPS, records GPS listener failures, and only marks GPS active after Android accepts updates.
- Added project rules requiring tracked changelog updates.
- Added Android phone style selection with Auto, Light, and Dark modes aligned with MotoHUD2 behavior.
- Changed the APPS Bridge keep-alive notification so standby stays quiet, the lightweight standby heartbeat remains active after the user opens the app, and the ongoing foreground notification is used while MotoHUD is actively streaming.
- Made MotoHUD foreground promotion non-fatal if Android rejects the location foreground-service transition while the bridge is backgrounded.
- Ported native Android colors, radius, spacing, tiles, and segmented buttons to the exact Even Toolkit phone UI tokens used by G2ToTP and MotoHUD2.
- Documented the Even Toolkit credit/source files used for the native Android theme port.
- Corrected Even Toolkit credit to the npm package author, repository, and MIT license.
- Bundled the Even Toolkit MIT notice in the Android APK assets.
- Ported additional Even Toolkit native equivalents for button variants, segmented controls, badges, checkbox/radio/toggle resources, list tiles, and typography scale.
- Changed the APPS Bridge foreground notification to stay active while any HUD WebSocket client is connected, not only while MotoHUD GPS streaming is active.
