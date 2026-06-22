# Install Even Hub tooling

*Lay down @evenrealities/even_hub_sdk, evenhub-simulator, and evenhub-cli on your machine.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/install-tools

> **Last updated:** 2026-06-08

With Node in place, three packages to install: the SDK, the simulator, and the CLI.

## SDK

Inside your project directory (the one with `package.json`):

```bash
npm install @evenrealities/even_hub_sdk@latest
```

The SDK is a **project dependency** - your app `import`s from it, so it lives in your `node_modules`, not on the system. No `-g`.

Current version: **0.0.10**, published 2026-04-10. It covers display control, input, audio, device info, and local storage. Whatever version you install, match it in `app.json`'s `min_sdk_version`.

> **npm:** [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## Simulator

```bash
npm install -g @evenrealities/evenhub-simulator
```

Current version: **0.7.2**. Runs on macOS, Linux, and Windows. Usage is in [Simulator](https://hub.evenrealities.com/docs/test/simulator).

> **npm:** [@evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)

## CLI

The CLI handles QR sideloading, manifest scaffolding, and `.ehpk` packaging. It ships an `evenhub` binary (and a shorter `eh` alias), so install it globally:

```bash
npm install -g @evenrealities/evenhub-cli
```

Current version: **0.1.12**.

> **npm:** [@evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli)

Full command list in the [CLI Reference](https://hub.evenrealities.com/docs/reference/cli); the manifest schema and packaging walkthrough is in [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging).

