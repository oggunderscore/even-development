# Even — G2 Smart Glasses Development Platform

Monorepo workspace for building apps on the **Even Realities G2** smart glasses platform.

## Naming Convention

All projects use the `even-` prefix:

```
even-<project-name>/
```

## Workspace Structure

```
even/
├── even-flipper/             # Flipper Zero → G2 BLE mirror (git submodule)
├── even-notifications/       # Phone notification bridge to G2
├── even-pilot/               # Driving HUD (GPS, speed, compass)
├── even-stands/              # G2 plugin (active development)
├── even-terminal/            # SSH/terminal/voice app
├── even-toolkit/             # Design system & SDK utilities (git submodule, npm)
├── even-realities-docs/      # Local mirror of official Even Hub developer docs
│
├── reference/                # SDK docs, community repos, code snippets, and reference apps
│   ├── even-bridge/          # Reference companion phone app (Android + iOS relay server)
│   ├── sdk/                  # SDK API reference, hardware constraints, dev patterns
│   ├── community/            # Cloned community repos for reference
│   │   ├── even-g2-notes/        # nickustinov — community notes & tips
│   │   ├── even-g2-protocol/     # i-soxi — BLE protocol reverse engineering
│   │   ├── evenhub-templates/    # even-realities — official starter templates
│   │   ├── g2-kit-unofficial/    # Commute773 — unofficial BLE + UI kit
│   │   ├── even-dev/             # BxNxM — simulator dev environment
│   │   └── weather-even-g2/      # nickustinov — weather app example
│   ├── snippets/             # Standalone utility code (canvas helpers, etc.)
│   └── getting-started-tips.md
│
├── .kiro/                    # Kiro AI steering & workspace config
├── CLAUDE.md                 # AI workspace context document
└── .gitmodules               # Git submodule definitions
```

## Projects

| Project              | Description                                                | Stack                    |
| -------------------- | ---------------------------------------------------------- | ------------------------ |
| `even-flipper`       | Flipper Zero screen mirror on G2 via BLE                   | TypeScript + Vite + SDK  |
| `even-notifications` | Phone notification bridge to G2                            | TypeScript + Vite + SDK  |
| `even-pilot`         | Driving HUD — speed, compass, location                     | TypeScript + Vite + SDK  |
| `even-stands`        | G2 plugin (active development)                             | TypeScript + Vite + SDK  |
| `even-terminal`      | SSH/terminal/voice app                                     | TypeScript + SDK         |
| `even-toolkit`       | Design system — 55+ web components, SDK bridge, STT, icons | TypeScript (npm package) |

## Reference

| Resource                   | Location / URL                                            |
| -------------------------- | --------------------------------------------------------- |
| Companion Bridge (ref app) | `reference/even-bridge/`                                  |
| Official Docs Mirror       | `even-realities-docs/`                                    |
| SDK API Reference          | `reference/sdk/`                                          |
| Official Templates         | `reference/community/evenhub-templates/`                  |
| Developer Docs             | https://hub.evenrealities.com/docs                        |
| SDK (npm)                  | https://www.npmjs.com/package/@evenrealities/even_hub_sdk |
| CLI (npm)                  | https://www.npmjs.com/package/@evenrealities/evenhub-cli  |
| Even Toolkit               | https://github.com/fabioglimb/even-toolkit                |
| Community Notes            | https://github.com/nickustinov/even-g2-notes              |
| BLE Protocol               | https://github.com/i-soxi/even-g2-protocol                |
| Unofficial BLE Kit         | https://github.com/Commute773/g2-kit-unofficial           |
| Discord                    | https://discord.gg/Y4jHMCU4sv                             |

## Platform Quick Facts

| Property   | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| Display    | 576×288 px per eye, 4-bit greyscale (16 green shades)        |
| Containers | Max 4 image + 8 other per page                               |
| Input      | Temple touchpad + optional R1 ring                           |
| SDK        | `@evenrealities/even_hub_sdk` v0.0.10                        |
| CLI        | `@evenrealities/evenhub-cli` v0.1.12                         |
| Simulator  | `@evenrealities/evenhub-simulator` v0.7.2                    |
| App model  | Web apps (HTML/CSS/JS/TS) inside WebView, bridged to glasses |

## Creating a New Project

1. Create folder with `even-` prefix: `even-<your-app>/`
2. Scaffold from official templates or `even-toolkit` CLI:
   ```bash
   npx even-toolkit my-app        # scaffold with even-toolkit
   # or
   npx degit even-realities/evenhub-templates/minimal even-myapp
   ```
3. Add to this README under Projects
4. Follow patterns in `even-realities-docs/` and `reference/sdk/`
