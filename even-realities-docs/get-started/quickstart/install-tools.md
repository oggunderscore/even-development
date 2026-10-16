# Install Even Hub tooling

*Install the global Even Hub CLI and simulator; add the SDK only inside an app project.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/install-tools

> **Last updated:** 2026-08-29

With Node in place, install the two global tools used before you create your first app:

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

The SDK is different: it is a project dependency, not a global tool. Install it only after you have an app project with a `package.json`.

## Simulator

Installed by the global tooling command above.

Current version: **0.9.3**, tracking SDK `0.0.14`. Runs on macOS, Linux, and Windows. Usage and caveats are in [Simulator](/docs/test/simulator); what each release added is in the [Changelog](/docs/reference/changelog).

> **npm:** [@evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)

## CLI

Installed by the global tooling command above. The CLI handles QR sideloading, manifest scaffolding, and `.ehpk` packaging. It ships an `evenhub` binary and a shorter `eh` alias.

Current version: **0.1.14**. Release history is in the [Changelog](/docs/reference/changelog).

> **npm:** [@evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli)

Full command list in the [CLI Reference](/docs/reference/cli); the manifest schema and packaging walkthrough is in [Packaging & Deployment](/docs/ship/packaging).

## SDK

The SDK is a **project dependency** - your app `import`s from it, so it lives in your app's `node_modules`, not on the system. No `-g`.

Route A in [Your First App](/docs/get-started/quickstart/first-app) creates a Vite project first, then runs this command from inside that project directory (the one with `package.json`):

```bash
npm install @evenrealities/even_hub_sdk@latest
```

Route B uses the official templates, which already include the SDK. For templates, run `npm install` for the template dependencies; do not install the SDK separately.

Current version: **0.0.14**, published 2026-08-20, with an Even App floor of **2.2.9**. Whatever version you install, match it in `app.json`'s `min_sdk_version`.

It covers display control, input, the [contextual menu](/docs/build/contextual-menu), [long press](/docs/build/device-apis#long-press), audio (glasses or phone mic), IMU, location, photo album and phone camera, device info, and local storage. What each release added is in the [Changelog](/docs/reference/changelog).

> **npm:** [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)
