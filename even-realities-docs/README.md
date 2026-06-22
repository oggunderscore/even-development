# Even Realities Developer Docs (local mirror)

Local markdown mirror of [hub.evenrealities.com/docs](https://hub.evenrealities.com/docs/get-started/overview), the official Even Hub developer documentation for the **Even G2 smart glasses**.

- **Snapshot date:** 2026-06-15
- **Site "Last updated" dates:** ranged 2026-06-04 to 2026-06-11 at snapshot time (each page below carries its own date)
- **Purpose:** offline/local reference so any project in this repo has full context on the Even Hub platform without re-fetching the site each time
- **Re-sync:** re-run the fetch if the live docs change meaningfully (check `reference/cli.md` and `reference/versioning.md` first - CLI/SDK versions are the fastest-moving numbers)

Every file keeps its `Source:` link back to the live page.

## Get Started

- [Overview](get-started/overview.md) - what the G2 is, hardware specs, what you can build
- [Architecture](get-started/architecture.md) - connection model, SDK bridge, network whitelist vs CORS
- [Quickstart](get-started/quickstart/index.md) - the one-page path from zero to running app
  - [Sign in](get-started/quickstart/sign-in.md)
  - [Hardware](get-started/quickstart/hardware.md) - pairing, firmware, Developer Mode, firewall/Wi-Fi setup
  - [Install Node.js & npm](get-started/quickstart/install-node.md)
  - [Install Even Hub tooling](get-started/quickstart/install-tools.md)
  - [Your First App](get-started/quickstart/first-app.md) - full "Hello from G2!" walkthrough
  - [Templates](get-started/quickstart/templates.md) - minimal / text-heavy / asr / image starters

## Build

- [Build index](build/index.md)
- [Page Lifecycle](build/page-lifecycle.md) - create/update/rebuild/shutdown calls
- [Display & UI System](build/display.md) - canvas, containers, text/list/image limits
- [Design Guidelines](build/design-guidelines.md) - Figma link, layout rules, useful Unicode glyphs
- [Device APIs](build/device-apis.md) - touchpads, ring, IMU, audio, device/user info, local storage
- [Networking](build/networking.md) - `fetch`, `app.json` whitelist, CORS
- [Background & Lifecycle](build/background-lifecycle.md) - what survives backgrounding (iOS vs Android)

## Test

- [Test index](test/index.md) - comparison table of the four modes
- [Simulator](test/simulator.md) - install, options, headless automation HTTP API
- [Local Testing](test/local-testing.md) - QR sideload + HMR
- [Private Testing](test/private-testing.md) - real `.ehpk` on your own glasses
- [Beta Testing](test/beta-testing.md) - reviewer-parity mode, required before submission

## Ship

- [Ship index](ship/index.md)
- [Packaging & Deployment](ship/packaging.md) - `app.json` schema, `evenhub pack`, troubleshooting
- [App Submission & QA Guidelines](ship/app-submission.md) - state machine, reviewer rubric, fix-forward versioning

## Reference

- [Reference index](reference/index.md)
- [CLI](reference/cli.md) - `evenhub` / `eh` commands
- [Glossary](reference/glossary.md)
- [Versioning Policy](reference/versioning.md) - semver, deprecation windows, `min_sdk_version`
- [FAQ](reference/faq.md) - "can I do X?" quick answers

## AI Tooling

- [AI Tooling index](ai-tooling/index.md)
- [Claude Code](ai-tooling/claude-code.md) - the `everything-evenhub` plugin and its 13-skill catalog (already installed in this environment)

## Key facts worth remembering

- **Display:** 576x288 px per eye, 4-bit greyscale (16 levels of green), no camera/speaker
- **Containers:** max 4 image + 8 other containers per page, exactly one with `isEventCapture: 1`
- **Current `edition`:** `"202601"` - **`min_sdk_version` floor:** `0.0.10` - **`min_app_version` floor:** `2.0.0`
- **CLI:** `@evenrealities/evenhub-cli` (v0.1.12) - **Simulator:** `@evenrealities/evenhub-simulator` (v0.7.2) - **SDK:** `@evenrealities/even_hub_sdk` (v0.0.10)
- **Package format:** `.ehpk` via `evenhub pack app.json dist -o myapp.ehpk`
- **Root page exit:** must call `bridge.shutDownPageContainer(1)` on double-tap (system exit dialog) - mode `0` or custom exit UI on root is auto-rejected in review
- **Network whitelist `app.json`** is an Even-side permission check only - it does **not** bypass CORS
