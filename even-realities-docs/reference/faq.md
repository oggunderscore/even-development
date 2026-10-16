# FAQ

*Quick-yes/no answers for the questions devs hit five minutes in. Skim it before opening a support ticket.*

Source: https://hub.evenrealities.com/docs/reference/faq

> **Last updated:** 2026-08-29

Most "can I do X?" questions have a one-line answer plus a pointer. That's what this page is, grouped by surface. If yours isn't here, check the [Glossary](/docs/reference/glossary) or open an issue in the dev portal.

## Display & rendering

| Q | A |
| --- | --- |
| Can I draw arbitrary pixels? | **No.** The display surface is a container-based model - text, images, and lists. See [Display & UI System](/docs/build/display). |
| Can I render full-color content? | **No.** The Even G2 display is monochrome green, 4-bit (16 shades). Source assets must be greyscale; the hardware tints them. |
| Can I show video / animated GIFs? | **No native support.** You can simulate animation by sequencing `textContainerUpgrade` or `updateImageRawData` calls - BLE bandwidth (~10–30 KB/s) limits practical frame rate. |
| Can I overlay containers (z-order)? | **Yes.** SDK `0.0.12+` adds explicit `zOrderIndex` - larger renders in front; **all-or-nothing per page** and values unique. Pages that omit it everywhere fall back to declaration order (later renders on top). See [Display & UI System](/docs/build/display#stacking-order-zorderindex). |
| Do I need to opt in to image compression? | **No.** SDK `0.0.12+` LZ4-compresses `updateImageRawData` payloads in transit automatically - zero code change, smaller transfers, faster image updates. |
| Why LZ4 instead of a higher-ratio codec? | LZ4 has the lowest decompression memory footprint and near-instant encode/decode, which fits the glasses' RTOS memory budget. Compression ratio was a deliberate trade-off, not the priority. |
| Can I change text brightness? | **Yes.** SDK `0.0.14+` adds `textColor` on text containers - five levels, `0`-`4`, despite the name it is brightness not color. Omit it for the device default `4`. See [Display & UI System](/docs/build/display#text-brightness). |
| Can I use my own font? | **No.** The glasses render with a fixed system font. Sizing/spacing follows [Design Guidelines](/docs/build/design-guidelines). |
| What size is the canvas? | **576×288** monochrome green pixels. See [Overview](/docs/get-started/overview). |
| Can I render emoji? | **No.** Use Unicode geometric / box-drawing characters instead. See [Glossary](/docs/reference/glossary). |

## Input & sensors

| Q | A |
| --- | --- |
| Can I detect a long press? | **Yes.** SDK `0.0.14+` (Even App `2.2.9+`) fires `LONG_PRESS_EVENT` when the press starts and `LONG_PRESS_RELEASE_EVENT` when it lifts - two separate events, ordinary list/text/sys routing. The OS claims tap then long press for its own menu, so a press only reaches you when your layer owns it. See [Device APIs → Long press](/docs/build/device-apis#long-press). |
| Can I add my own items to the glasses menu? | **Yes.** SDK `0.0.14+` (Even App `2.2.9+`) lets you attach up to 10 action items via `menuObject` on create/rebuild; selections arrive as `menuItemClickEvent`. See [Contextual Menu](/docs/build/contextual-menu). |
| Can a menu item show state, like a toggle? | **No.** Every item is fire-and-forget - one event, menu closes, the glasses never re-render the label. Re-declare the menu to change what it reads. See [Contextual Menu](/docs/build/contextual-menu#fire-and-forget-only). |
| Can I read raw IMU sensor data? | **Yes.** `IMU_DATA_REPORT` events stream at configurable rate. See [Device APIs → IMU](/docs/build/device-apis#imu). A units table is still TBD. |
| Can I pick which microphone to capture? | **Yes** - pass `AudioInputSource.Glasses` or `AudioInputSource.Phone` to `audioControl(true, ...)`. Default is glasses. Each source is mono. Per-mic capture inside the glasses four-mic array + DOA angle reporting is on the roadmap. See [Device APIs → Audio](/docs/build/device-apis#audio). |
| Can I trigger haptics on the glasses or R1? | **No.** No haptic actuator. |
| Can I detect when the glasses are being worn? | **Yes.** Wearing-detection events fire on put-on / take-off. See [Device APIs](/docs/build/device-apis). |
| Can I read battery level? | **Yes.** Device info API exposes battery percentage. See [Device APIs](/docs/build/device-apis). |

## Networking

| Q | A |
| --- | --- |
| Can I `fetch()` arbitrary URLs? | **No.** The domain must be in your `app.json` `network` whitelist. See [Networking](/docs/build/networking#required-server-side-cors-headers). |
| Does the network whitelist bypass CORS? | **No.** Whitelist is necessary but not sufficient - remote API still needs `Access-Control-Allow-Origin`. |
| Can I open a WebSocket? | **Yes** - same whitelist rules. Expect drops when the WebView backgrounds. See [Background & Lifecycle](/docs/build/background-lifecycle). |
| Can I open a deep link in the system browser? | **TBD.** Currently no `window.open(url, '_system')` equivalent. Track via the dev portal. |
| Can I receive push notifications? | **No.** Plugins are foreground-only on the glasses. The phone app receives notifications and may surface them in its own UI. |
| Can I make network calls while backgrounded? | **No.** WebView is suspended on background; in-flight requests stall. Plan for resume. See [Background & Lifecycle](/docs/build/background-lifecycle). |

## Storage & state

| Q | A |
| --- | --- |
| Can I use `localStorage`? | **Yes** - survives suspension, kill, and update. Cleared on uninstall. |
| Can I use `IndexedDB` or `OPFS`? | **Yes**, but quotas are not yet documented. Treat as "best-effort, persistent." Deep-dive coming. |
| Does state sync between the phone and the glasses? | **No** - app state lives in the WebView on the phone. The glasses are a render target, not a state store. |
| Can I share state between two of my apps on the same device? | **No.** Storage is sandboxed per `package_id`. |
| Can I read/write the user's media library or files? | **Read: limited.** A user-driven single-image picker via `pickImageFromAlbum()` (with the `album` permission) returns one `AppImageAsset`. No bulk read, no write, no file system, no clipboard. See [Device APIs → Photos](/docs/build/device-apis#photos). |

## Packaging & submission

| Q | A |
| --- | --- |
| Can I publish without a developer account? | **No.** Account at `hub.evenrealities.com` is required. See [Sign in](/docs/get-started/quickstart/sign-in). |
| Can I roll back a released version? | **No.** Fix-forward only. See [Submission Flow](/docs/ship/app-submission#fix-forward-versioning). |
| Do I set `min_app_version` myself? | **No.** The CLI derives it from your SDK version at pack time and stamps it into the `.ehpk`. Declare it in `app.json` only to pin a stricter floor; `--enforce-manual-version` overrides it for local testing. See [Auto-deriving `min_app_version`](/docs/ship/packaging#auto-derivation). |
| Why won't my plugin open on an older app? | Its `min_app_version` (the SDK floor it was packed against) is higher than the user's Even Realities App version, so the app blocks it at open with an update prompt - shown on the glasses if launched there. The user updates the app to open it. See [the open-time gate](/docs/reference/versioning#min-app-version). |
| Can I commit my API key to the `.ehpk`? | **No** - anyone with the released `.ehpk` can extract bundled contents. Move keys behind a server-side proxy. See [Submission Flow](/docs/ship/app-submission). |
| Can I edit `app.json` after submission? | **Not after Submitted state.** Edit metadata in Draft / Test only. |
| Can I publish a hotfix without going through review? | **No.** Every version goes through the same review path. Hotfix versions are usually approved faster but not bypassed. |
| Can I ship to specific countries / regions? | **Not currently.** All Released versions are globally visible. |
| Can I price my app? | **TBD.** No paid distribution yet. |
| What's the maximum `.ehpk` size? | Practical cap is currently **~10 MB** - larger packages still upload but degrade install UX over BLE. |

## Testing

| Q | A |
| --- | --- |
| Can I test on the simulator alone? | **For UI/logic work, yes.** For backgrounding, real permissions, or BLE timing, you need hardware. See [Testing Modes](/docs/test/). |
| Can I share a build with a teammate? | **Yes** - via Beta groups in the dev portal. They install from the phone app's Beta tester section. |
| Can I automate sim testing in CI? | **Yes** - the simulator exposes an HTTP API. See [Headless Testing](/docs/test/simulator#headless-automation). |
| Can I install two of my own apps side-by-side? | **Yes.** Each has its own `package_id`, its own container, its own state. |
| Can I see device logs from real hardware? | **Console output appears in the phone app's dev console** when in Developer Mode. See [Enable Developer Mode](/docs/get-started/quickstart/hardware#enable-developer-mode). |

## Languages & locales

| Q | A |
| --- | --- |
| Which languages are supported in `supported_languages`? | Currently: `en, de, fr, es, it, zh, ja, ko`. |
| How are translations selected at runtime? | Device locale → first match in `supported_languages` → first item if none match. |
| How do I localize my UI strings? | **TBD - Internationalisation page coming.** For now, switch on `bridge.getDeviceInfo().locale`. |
| Can I add a locale not in the supported list? | **No.** Submission validation rejects unknown locales. |

## Privacy & permissions

| Q | A |
| --- | --- |
| Does my app see the user's name / email? | **Only with the user-info permission**, and only what they consented to share. |
| Does my app see other apps' data? | **No.** Strict per-`package_id` sandbox. |
| Does my app see ambient audio when not actively capturing? | **No.** Capture only fires while `audioControl(true)` is held and the user has granted the mic permission. |
| Can my app access the camera? | **Not on the glasses** - the Even G2 has no camera (privacy-by-design). It can capture from the **phone camera** via `captureImageFromCamera()` with the `camera` permission. See [Device APIs → Photos](/docs/build/device-apis#photos). |

## Misc

| Q | A |
| --- | --- |
| Can I build with React / Vue / Svelte? | **Yes** - the SDK is framework-agnostic. The boilerplate uses vanilla TS for size; bring whatever framework you prefer. |
| Can I use TypeScript? | **Yes** - it's the recommended path. The SDK ships full type definitions. |
| Can I use ESM imports? | **Yes** - the SDK is ESM-first. Vite handles bundling. |
| Can I use AI tooling (Claude Code) to develop? | **Yes** - see [Claude Code](/docs/learn/claude-code) for the plugin and its skill catalog. |

## Related

- [Glossary](/docs/reference/glossary) - definitions referenced above
- [Versioning Policy](/docs/reference/versioning) - when "TBD" becomes "available"
- [Architecture](/docs/get-started/architecture) - the model these answers compose against
