# Even G2 App

Starter project for [Even Realities G2](https://hub.evenrealities.com/docs/getting-started/overview) smart glasses development using the Even Hub Open SDK.

## Prerequisites

- Node.js **v20 LTS** or **v22+** (you have v22 — good)
- [Even Realities App](https://hub.evenrealities.com/) on your phone (for hardware testing)
- Even G2 glasses (optional during early UI work — use the simulator first)

## Tooling

| Tool | Package | Purpose |
| --- | --- | --- |
| SDK | `@evenrealities/even_hub_sdk` | Bridge to glasses display, input, audio, storage |
| Simulator | `@evenrealities/evenhub-simulator` | Preview UI on your computer |
| CLI | `@evenrealities/evenhub-cli` | QR sideload, auth, packaging (`.ehpk`) |

## Setup

```bash
npm install
npm install -g @evenrealities/evenhub-simulator @evenrealities/evenhub-cli
```

## Development workflow

```bash
# 1. Start the dev server
npm run dev

# 2. Preview in the simulator (separate terminal)
npm run simulator

# 3. Test on hardware — scan QR with the Even Realities App
npm run qr
```

## Build & package

```bash
npm run pack
# produces even-g2-app.ehpk for upload to the developer portal
```

## Architecture

Your app is a standard web app (Vite + TypeScript) running inside the Even Realities App WebView on the phone. The phone relays display commands and input events to the glasses over Bluetooth.

```
Cloud (Even Hub) ←→ Phone (WebView + your app) ←→ G2 Glasses
```

See [Architecture](https://hub.evenrealities.com/docs/getting-started/architecture) for details.

## Key SDK notes

- Call `createStartUpPageContainer` exactly once at startup before other UI calls.
- Use `textContainerUpgrade` for frequent text updates (no flicker).
- Use `rebuildPageContainer` when changing layout.
- Display: 576×288 px per eye, 4-bit green grayscale (16 shades).
- Network calls require both `app.json` whitelist **and** server-side CORS.

## Resources

- [Docs overview](https://hub.evenrealities.com/docs/getting-started/overview)
- [Packaging & Deployment](https://hub.evenrealities.com/docs/reference/packaging)
- [Design Guidelines (Figma)](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782)
- [Community notes (G2)](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md)
- [Community toolkit](https://github.com/fabioglimb/even-toolkit)
- [Discord](https://discord.gg/Y4jHMCU4sv)
