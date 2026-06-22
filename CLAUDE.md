# Even Realities Workspace

This folder (`Desktop/Even/`) is a parent workspace holding multiple independent projects built for the **Even Realities G2 smart glasses** platform. Each subfolder is its own project (some are git repos, some aren't) - treat them as siblings, not a monorepo.

## First stop: local docs mirror

**[`even-realities-docs/`](even-realities-docs/README.md)** is a full local markdown mirror of the official Even Hub developer docs (hub.evenrealities.com/docs), fetched 2026-06-15. Read it for anything platform-related - SDK APIs, display/container limits, manifest schema, CLI, simulator, packaging, submission/QA rules, networking/CORS, background lifecycle, etc. Don't guess at platform constraints; check there first since the answers are specific and often counter-intuitive (e.g. no CSS/DOM, fixed container limits, network whitelist ≠ CORS bypass).

Quick facts (full detail in the docs mirror):

- **Display:** 576x288 px per eye, 4-bit greyscale (16 levels of green), monochrome. No camera, no speaker.
- **UI model:** absolute-pixel **containers** (text/list/image) - no HTML/CSS/DOM on the glasses themselves. Max 4 image + 8 other containers per page; exactly **one** container has `isEventCapture: 1`.
- **Bridge:** `@evenrealities/even_hub_sdk` exposes `EvenAppBridge` inside a WebView hosted by the Even Realities phone app. `waitForEvenAppBridge()` must be awaited before any other call.
- **Current platform versions:** `edition: "202601"`, `min_app_version: "2.0.0"`, `min_sdk_version: "0.0.10"`. CLI `@evenrealities/evenhub-cli` v0.1.12, simulator `@evenrealities/evenhub-simulator` v0.7.2.
- **Root-page exit:** double-tap must call `bridge.shutDownPageContainer(1)` (system exit dialog). Mode `0` or a custom exit UI on the root page is auto-rejected in QA review.
- **Testing ladder:** Simulator (no hardware) → Local Testing (QR sideload + HMR) → Private Testing (real `.ehpk` on your glasses) → Beta Testing (reviewer-parity, required before submission - 5-minute locked-phone test).
- **Packaging:** `evenhub pack app.json dist -o myapp.ehpk`. Once a version is Released it's immutable - fix-forward only.

## AI tooling already installed

The **`everything-evenhub` Claude Code plugin** is installed in this environment (see the `everything-evenhub:*` skills). It adds 13 skills covering the full lifecycle - `quickstart`, `template`, `build-and-deploy`, `glasses-ui`, `handle-input`, `device-features`, `background-state`, `test-with-simulator`, `simulator-automation`, `font-measurement`, `sdk-reference`, `cli-reference`, `design-guidelines`. These are picked automatically based on the task - prefer letting them fire rather than reinventing their logic, but cross-check against `even-realities-docs/` when something seems off, since the docs are the source of truth and the skills are a wrapper around them.

## Projects in this workspace

- **`even-realities-docs/`** - local mirror of the official Even Hub docs (see above). Reference only, not a buildable project.
- **`even-toolkit/`** (git repo) - `even-toolkit` npm package: design system / component library for G2 apps. 55+ web components (`web/`), pixel-art icons, an SDK bridge wrapper with per-screen architecture (`glasses/`), an STT module (`stt/`), light/dark themes and design tokens following the Even Realities UIUX guidelines. Has its own `package.json`, `README.md`, `CHANGELOG.md`.
- **`even-flipper/`** (git repo) - "Flipper-Zero-on-G2-Glasses": a Bluetooth bridge that mirrors a Flipper Zero's screen onto G2 glasses and lets the d-pad be driven via temple-touch gestures. Has `flipper-bridge/` (BLE relay), `linux-bridge/`, and `g2-starter/` (the actual G2 webapp/plugin, built with Vite + the SDK - has `app.json`, `index.html`, `src/`). Check its README for current validation status - several integration paths are explicitly marked unverified on real hardware.
- **`appsbridge-main/`** - "APPS Bridge": companion phone app (Android Kotlin + iOS Swift) that runs a local HTTP/WebSocket server on the phone to relay GPS, media, nav, and audio/captions to HUD clients (MotoHUD, CC Live) over BLE/network, including a Flipper Zero BLE relay path. Its UI is themed with `even-toolkit` design tokens. Has Kiro steering docs at `.kiro/steering/` (`product.md`, `structure.md`, `tech.md`) with full architecture detail - read those before working in this project. No test framework configured.
- **`even-better-sdk-reference.md`** - reference notes for the community npm package `@jappyjan/even-better-sdk`, an opinionated wrapper over the official SDK (fluent page/element builder, partial text updates, singleton init, storage helpers). Useful if a project depends on it instead of (or alongside) the raw SDK.
- **`tips.md`** - informal personal notes on the basic Even Hub dev loop (Vite, CLI, simulator, SDK bridge import, Figma design link).
- **`sendImageWithCenteredText.ts`** - standalone helper snippet: renders text centered over an image on a canvas (288x144) for use with G2 image containers.

## Working conventions

- When starting a **new** Even Hub plugin/app project, scaffold per `even-realities-docs/get-started/quickstart/first-app.md` (Vite + TypeScript + `@evenrealities/even_hub_sdk`) or use the `quickstart`/`template` skills - don't hand-roll a different structure.
- Always `await waitForEvenAppBridge()` before any other bridge call - calling earlier silently no-ops.
- Prefer `textContainerUpgrade` over `rebuildPageContainer` for in-place updates (flicker-free); reserve rebuilds for actual layout changes.
- When touching `app.json`, validate against `even-realities-docs/ship/packaging.md` (field reference + permissions format) - `permissions` is an array of objects, not a map.
- Respect the display constraints (576x288, greyscale, container caps) - there's no CSS/DOM fallback on-glasses.
