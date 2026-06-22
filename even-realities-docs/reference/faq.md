# FAQ

*Quick-yes/no answers for the questions devs hit five minutes in. Skim it before opening a support ticket.*

Source: https://hub.evenrealities.com/docs/reference/faq

> **Last updated:** 2026-06-04

Most "can I do X?" questions have a one-line answer plus a pointer. That's what this page is, grouped by surface. If yours isn't here, check the [Glossary](https://hub.evenrealities.com/docs/reference/glossary) or open an issue in the dev portal.

## Display & rendering

| Q | A |
| --- | --- |
| Can I draw arbitrary pixels? | **No.** The display surface is a container-based model - text, images, and lists. See [Display & UI System](https://hub.evenrealities.com/docs/build/display). |
| Can I render full-color content? | **No.** The G2 display is monochrome green, 4-bit (16 shades). Source assets must be greyscale; the hardware tints them. |
| Can I show video / animated GIFs? | **No native support.** You can simulate animation by sequencing `textContainerUpgrade` or `updateImageRawData` calls - BLE bandwidth (~10–30 KB/s) limits practical frame rate. |
| Can I overlay containers (z-order)? | **Yes** - declaration order controls overlap. Later containers render on top. |
| Can I use my own font? | **No.** The glasses render with a fixed system font. Sizing/spacing follows [Design Guidelines](https://hub.evenrealities.com/docs/build/design-guidelines). |
| What size is the canvas? | **576×288** monochrome green pixels. See [Overview](https://hub.evenrealities.com/docs/get-started/overview). |
| Can I render emoji? | **No.** Use Unicode geometric / box-drawing characters instead. See [Glossary](https://hub.evenrealities.com/docs/reference/glossary). |

## Input & sensors

| Q | A |
| --- | --- |
| Can I read raw IMU sensor data? | **Yes.** `IMU_DATA_REPORT` events stream at configurable rate. See [Device APIs → IMU](https://hub.evenrealities.com/docs/build/device-apis#imu). A units table is still TBD. |
| Can I capture audio from a specific microphone? | **Currently mono only.** Per-mic capture + DOA angle reporting is on the roadmap (multi-mic expansion). |
| Can I trigger haptics on the glasses or R1? | **No.** No haptic actuator. |
| Can I detect when the glasses are being worn? | **Yes.** Wearing-detection events fire on put-on / take-off. See [Device APIs](https://hub.evenrealities.com/docs/build/device-apis). |
| Can I read battery level? | **Yes.** Device info API exposes battery percentage. See [Device APIs](https://hub.evenrealities.com/docs/build/device-apis). |

## Networking

| Q | A |
| --- | --- |
| Can I `fetch()` arbitrary URLs? | **No.** The domain must be in your `app.json` `network` whitelist. See [Networking](https://hub.evenrealities.com/docs/build/networking#required-server-side-cors-headers). |
| Does the network whitelist bypass CORS? | **No.** Whitelist is necessary but not sufficient - remote API still needs `Access-Control-Allow-Origin`. |
| Can I open a WebSocket? | **Yes** - same whitelist rules. Expect drops when the WebView backgrounds. See [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle). |
| Can I open a deep link in the system browser? | **TBD.** Currently no `window.open(url, '_system')` equivalent. Track via the dev portal. |
| Can I receive push notifications? | **No.** Plugins are foreground-only on the glasses. The phone app receives notifications and may surface them in its own UI. |
| Can I make network calls while backgrounded? | **No.** WebView is suspended on background; in-flight requests stall. Plan for resume. See [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle). |

## Storage & state

| Q | A |
| --- | --- |
| Can I use `localStorage`? | **Yes** - survives suspension, kill, and update. Cleared on uninstall. |
| Can I use `IndexedDB` or `OPFS`? | **Yes**, but quotas are not yet documented. Treat as "best-effort, persistent." Deep-dive coming. |
| Does state sync between the phone and the glasses? | **No** - app state lives in the WebView on the phone. The glasses are a render target, not a state store. |
| Can I share state between two of my apps on the same device? | **No.** Storage is sandboxed per `package_id`. |
| Can I read/write the user's media library or files? | **No.** Pure WebView sandbox. No file system, no media, no clipboard. |

## Packaging & submission

| Q | A |
| --- | --- |
| Can I publish without a developer account? | **No.** Account at `hub.evenrealities.com` is required. See [Sign in](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in). |
| Can I roll back a released version? | **No.** Fix-forward only. See [Submission Flow](https://hub.evenrealities.com/docs/ship/app-submission#fix-forward-versioning). |
| Can I commit my API key to the `.ehpk`? | **No** - anyone with the released `.ehpk` can extract bundled contents. Move keys behind a server-side proxy. See [Submission Flow](https://hub.evenrealities.com/docs/ship/app-submission). |
| Can I edit `app.json` after submission? | **Not after Submitted state.** Edit metadata in Draft / Test only. |
| Can I publish a hotfix without going through review? | **No.** Every version goes through the same review path. Hotfix versions are usually approved faster but not bypassed. |
| Can I ship to specific countries / regions? | **Not currently.** All Released versions are globally visible. |
| Can I price my app? | **TBD.** No paid distribution yet. |
| What's the maximum `.ehpk` size? | Practical cap is currently **~10 MB** - larger packages still upload but degrade install UX over BLE. |

## Testing

| Q | A |
| --- | --- |
| Can I test on the simulator alone? | **For UI/logic work, yes.** For backgrounding, real permissions, or BLE timing, you need hardware. See [Testing Modes](https://hub.evenrealities.com/docs/test/). |
| Can I share a build with a teammate? | **Yes** - via Beta groups in the dev portal. They install from the phone app's Beta tester section. |
| Can I automate sim testing in CI? | **Yes** - the simulator exposes an HTTP API. See [Headless Testing](https://hub.evenrealities.com/docs/test/simulator#headless-automation). |
| Can I install two of my own apps side-by-side? | **Yes.** Each has its own `package_id`, its own container, its own state. |
| Can I see device logs from real hardware? | **Console output appears in the phone app's dev console** when in Developer Mode. See [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode). |

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
| Can my app access the camera? | **No** - there is no camera on the G2. Privacy-by-design. |

## Misc

| Q | A |
| --- | --- |
| Can I build with React / Vue / Svelte? | **Yes** - the SDK is framework-agnostic. The boilerplate uses vanilla TS for size; bring whatever framework you prefer. |
| Can I use TypeScript? | **Yes** - it's the recommended path. The SDK ships full type definitions. |
| Can I use ESM imports? | **Yes** - the SDK is ESM-first. Vite handles bundling. |
| Can I use AI tooling (Claude Code) to develop? | **Yes** - there's a dedicated [AI Tooling](https://hub.evenrealities.com/docs/AI-tooling/) section with the skill catalog. |

## Related

- [Glossary](https://hub.evenrealities.com/docs/reference/glossary) - definitions referenced above

- [Versioning Policy](https://hub.evenrealities.com/docs/reference/versioning) - when "TBD" becomes "available"

- [Architecture](https://hub.evenrealities.com/docs/get-started/architecture) - the model these answers compose against

