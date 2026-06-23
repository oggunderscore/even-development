# Even Realities Workspace

This folder (`Desktop/Even/`) is a platform workspace for building apps on the **Even Realities G2 smart glasses**. All projects follow the `even-` naming prefix. Each subfolder is its own project (some are git submodules, some standalone) — treat them as siblings, not a monorepo.

## Naming Convention

**All projects are prefixed with `even-`** (e.g. `even-stands`, `even-toolkit`, `even-pilot`). This applies to all projects in this workspace.

## First stop: local docs mirror

**[`even-realities-docs/`](even-realities-docs/README.md)** is a full local markdown mirror of the official Even Hub developer docs (hub.evenrealities.com/docs), fetched 2026-06-15. Read it for anything platform-related — SDK APIs, display/container limits, manifest schema, CLI, simulator, packaging, submission/QA rules, networking/CORS, background lifecycle, etc. Don't guess at platform constraints; check there first since the answers are specific and often counter-intuitive (e.g. no CSS/DOM, fixed container limits, network whitelist ≠ CORS bypass).

Quick facts (full detail in the docs mirror):

- **Display:** 576x288 px per eye, 4-bit greyscale (16 levels of green), monochrome. No camera, no speaker.
- **UI model:** absolute-pixel **containers** (text/list/image) — no HTML/CSS/DOM on the glasses themselves. Max 4 image + 8 other containers per page; exactly **one** container has `isEventCapture: 1`.
- **Bridge:** `@evenrealities/even_hub_sdk` exposes `EvenAppBridge` inside a WebView hosted by the Even Realities phone app. `waitForEvenAppBridge()` must be awaited before any other call.
- **Current platform versions:** `edition: "202601"`, `min_app_version: "2.0.0"`, `min_sdk_version: "0.0.10"`. CLI `@evenrealities/evenhub-cli` v0.1.12, simulator `@evenrealities/evenhub-simulator` v0.7.2.
- **Root-page exit:** double-tap must call `bridge.shutDownPageContainer(1)` (system exit dialog). Mode `0` or a custom exit UI on the root page is auto-rejected in QA review.
- **Testing ladder:** Simulator (no hardware) → Local Testing (QR sideload + HMR) → Private Testing (real `.ehpk` on your glasses) → Beta Testing (reviewer-parity, required before submission — 5-minute locked-phone test).
- **Packaging:** `evenhub pack app.json dist -o myapp.ehpk`. Once a version is Released it's immutable — fix-forward only.

## Projects in this workspace

### G2 Apps

- **`even-stands/`** — Active G2 plugin project (Vite + TypeScript + SDK).
- **`even-pilot/`** — Driving HUD: speed, speed limit, compass direction, location via GPS + Overpass + Nominatim.
- **`even-terminal/`** — SSH/terminal/voice app.
- **`even-notifications/`** — Phone notification bridge to G2 via APPS Bridge.
- **`even-flipper/`** (git submodule → cola-collabs/even-flipper) — "Flipper-Zero-on-G2-Glasses": Bluetooth bridge that mirrors a Flipper Zero's screen onto G2 glasses with temple-touch gesture control. Has `flipper-bridge/` (BLE relay), `linux-bridge/`, and `g2-starter/` (the actual G2 webapp/plugin, built with Vite + the SDK). Check its README for current validation status.

### Shared Libraries

- **`even-toolkit/`** (git submodule → fabioglimb/even-toolkit) — `even-toolkit` npm package v1.7.2: design system & component library for G2 apps. 55+ web components (`web/`), pixel-art icons, an SDK bridge wrapper with per-screen architecture (`glasses/`), an STT module (`stt/`), light/dark themes and design tokens following the Even Realities UIUX guidelines.

### Reference & Documentation

- **`even-realities-docs/`** — Full local mirror of the official Even Hub docs. Reference only, not a buildable project.
- **`reference/even-bridge/`** — Reference companion phone app (Android Kotlin + iOS Swift) that runs a local HTTP/WebSocket server on the phone to relay GPS, media, nav, and audio/captions to HUD clients (MotoHUD, CC Live). Its UI is themed with `even-toolkit` design tokens. Has Kiro steering docs at `.kiro/steering/` with full architecture detail.
- **`reference/sdk/`** — SDK API reference, hardware constraints, development patterns, CLI reference, dev workflow docs, even-better-sdk wrapper docs.
- **`reference/community/`** — Cloned community repos for local reference:
  - `even-g2-notes` — nickustinov's community notes & tips
  - `even-g2-protocol` — i-soxi's BLE protocol reverse engineering
  - `evenhub-templates` — Official Even Realities starter templates (minimal, asr, image, text-heavy)
  - `g2-kit-unofficial` — Commute773's unofficial BLE transport + UI abstractions
  - `even-dev` — BxNxM's simulator dev environment
  - `weather-even-g2` — Weather app example by nickustinov
- **`reference/snippets/`** — Standalone utility code (e.g. canvas text rendering for G2 image containers).
- **`reference/getting-started-tips.md`** — Informal notes on the basic Even Hub dev loop.

## AI tooling already installed

The **`everything-evenhub` Claude Code plugin** is installed in this environment (see the `everything-evenhub:*` skills). It adds 13 skills covering the full lifecycle — `quickstart`, `template`, `build-and-deploy`, `glasses-ui`, `handle-input`, `device-features`, `background-state`, `test-with-simulator`, `simulator-automation`, `font-measurement`, `sdk-reference`, `cli-reference`, `design-guidelines`. These are picked automatically based on the task — prefer letting them fire rather than reinventing their logic, but cross-check against `even-realities-docs/` when something seems off, since the docs are the source of truth and the skills are a wrapper around them.

## Hardware Constraints (G2)

| Property            | Value                                           |
| ------------------- | ----------------------------------------------- |
| Display             | 576 × 288 px, 4-bit greyscale (16 green shades) |
| Text lines          | 10 maximum                                      |
| Containers per page | 4 image + 8 other (12 total)                    |
| Input               | Temple touchpad + optional R1 ring              |
| Connectivity        | BLE 5.2 to iPhone                               |
| Image tile max      | 288 × 144 px                                    |

## SDK Core Patterns

```typescript
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";

const bridge = await waitForEvenAppBridge();

// Initial render — call once only
await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 4,
    textObject: [
      /* TextContainerProperty objects */
    ],
  }),
);

// Update text without flicker
await bridge.textContainerUpgrade(
  new TextContainerUpgrade({
    containerID: 3,
    containerName: "speed",
    content: "72 mph",
  }),
);

// Exit
await bridge.shutDownPageContainer();
```

### Input Events

```typescript
const unsub = bridge.onEvenHubEvent((event) => {
  const sysType = event.sysEvent?.eventType ?? -1;
  const textType = event.textEvent?.eventType ?? 0; // 0 = CLICK_EVENT

  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    unsub();
    bridge.shutDownPageContainer();
    return;
  }

  if (textType === OsEventTypeList.CLICK_EVENT) {
    /* single tap */
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    /* swipe down */
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    /* swipe up */
  }

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    unsub();
  }
});
```

## Known SDK Quirks

- **`borderRdaius` typo** — the SDK property is misspelled `borderRdaius`. Use the typo.
- **CLICK_EVENT = 0** — protobuf omits zero-value fields; tap events arrive as `undefined`. Always coerce with `?? 0`.
- **`createStartUpPageContainer` is one-shot** — call exactly once. All updates use `textContainerUpgrade`.
- **Images need a second call** — call `updateImageRawData()` separately after initial page load.
- **Throttle scroll events** — apply ~300 ms debounce to avoid request queue buildup.
- **`isEventCapture`** — exactly one container per page must set this to `1`.

## Working Conventions

- All projects use the `even-` prefix.
- When starting a **new** Even Hub plugin/app, scaffold per `even-realities-docs/get-started/quickstart/first-app.md` (Vite + TypeScript + `@evenrealities/even_hub_sdk`) or use the `quickstart`/`template` skills.
- Always `await waitForEvenAppBridge()` before any other bridge call.
- Prefer `textContainerUpgrade` over `rebuildPageContainer` for in-place updates (flicker-free); reserve rebuilds for actual layout changes.
- When touching `app.json`, validate against `even-realities-docs/ship/packaging.md`.
- Respect the display constraints (576x288, greyscale, container caps) — there's no CSS/DOM fallback on-glasses.

## Key Resources

| Resource             | URL                                                       |
| -------------------- | --------------------------------------------------------- |
| Developer Docs       | https://hub.evenrealities.com/docs                        |
| SDK (npm)            | https://www.npmjs.com/package/@evenrealities/even_hub_sdk |
| CLI (npm)            | https://www.npmjs.com/package/@evenrealities/evenhub-cli  |
| Official Templates   | https://github.com/even-realities/evenhub-templates       |
| Community Toolkit    | https://github.com/fabioglimb/even-toolkit                |
| Community Notes      | https://github.com/nickustinov/even-g2-notes              |
| BLE Protocol         | https://github.com/i-soxi/even-g2-protocol                |
| Unofficial BLE Kit   | https://github.com/Commute773/g2-kit-unofficial           |
| Community Better SDK | https://www.npmjs.com/package/@jappyjan/even-better-sdk   |
| Discord              | https://discord.gg/Y4jHMCU4sv                             |

## Claude Code Skills (everything-evenhub plugin)

| Skill                   | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `/glasses-ui`           | Build display layouts and containers              |
| `/handle-input`         | Touchpad gestures, ring, lifecycle                |
| `/test-with-simulator`  | Launch simulator for local debug                  |
| `/simulator-automation` | HTTP API for screenshots and input injection      |
| `/font-measurement`     | Pixel-accurate text measurement (LVGL-aligned)    |
| `/sdk-reference`        | Look up SDK API and types                         |
| `/cli-reference`        | Look up CLI commands                              |
| `/design-guidelines`    | G2 display constraints and UX best practices      |
| `/background-state`     | Persist state across phone background transitions |
