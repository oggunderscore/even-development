# Development Workflow

## Tools Installed

| Tool | Version | Purpose |
|------|---------|---------|
| `@evenrealities/even_hub_sdk` | 0.0.10 | Bridge SDK (local dep) |
| `@evenrealities/evenhub-simulator` | 0.7.3 | Desktop preview |
| `@evenrealities/evenhub-cli` | 0.1.13 | QR sideload + packaging |
| `vite` | 7.3.x | Dev server + bundler |
| `typescript` | 5.9.x | Type safety |

## Daily Commands

```bash
# Start dev server
npm run dev

# Open simulator (separate terminal)
npm run simulator

# Sideload to phone over LAN (glasses connected to phone)
npm run qr
# or with explicit IP:
npx evenhub qr --url "http://192.168.x.x:5173"

# Build + package for submission
npm run pack
# → produces even-g2-app.ehpk
```

## Simulator

- URL: `http://localhost:5173` (from the simulator's perspective)
- Simulator version 0.7.3 — HTTP API available for automation
- Simulator automation: `GET /screenshot`, `POST /input` (see `/simulator-automation` skill)

## Sideloading

1. `npm run dev` → Vite server on port 5173
2. `npm run qr` → displays QR code
3. Open Even Realities iPhone app → scan QR
4. Glasses connects over BLE to phone; phone connects over LAN to dev server

**Important:** Use your machine's LAN IP (e.g. `192.168.1.x`), NOT `localhost` — the phone connects over Wi-Fi.

## File Structure

```
Even/
├── app.json          ← manifest (package_id, version, permissions)
├── index.html        ← WebView shell
├── src/
│   ├── main.ts       ← plugin entry point (import bridge here)
│   └── style.css     ← WebView styles (not shown on glasses)
├── vite.config.ts    ← dev server config
├── tsconfig.json     ← strict TypeScript
└── docs/             ← our working docs (this folder)
    ├── sdk-api-reference.md
    ├── hardware-constraints.md
    ├── integration-ideas.md
    └── dev-workflow.md (this file)
```

## app.json Manifest

```json
{
  "package_id": "com.kevin.evenapp",  ← must be unique in Even Hub store
  "edition": "202601",               ← YYYYMM format date stamp
  "name": "Even G2 App",
  "version": "0.1.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.10",
  "entrypoint": "index.html",
  "permissions": [],                 ← add "microphone", "network", etc as needed
  "supported_languages": ["en"]
}
```

## TypeScript Config Notes

- Target: ES2022, module: ESNext
- Strict mode + `noUnusedLocals` + `noUnusedParameters` — keep code clean
- `noEmit: true` — tsc is type-check only; Vite handles bundling

## Distribution

1. `npm run build` → `dist/`
2. `npm run pack` → `even-g2-app.ehpk`
3. Upload to https://hub.evenrealities.com or sideload via QR for testing

## Claude Code Skills (install once)

```
/plugin marketplace add even-realities/everything-evenhub
```

Then use:
- `/glasses-ui` — build display layouts
- `/handle-input` — input events
- `/device-features` — audio, IMU, storage
- `/background-state` — persist state across phone background
- `/test-with-simulator` — simulator debug
- `/simulator-automation` — automated testing
- `/sdk-reference` — API lookup
- `/design-guidelines` — display constraints
