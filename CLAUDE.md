# Even Realities G2 — Workspace

This directory is a workspace for **Even Realities G2 smart glasses** projects.  
Each project lives in its own subdirectory. Shared documentation stays at the root.

---

## Workspace Layout

```
Even/
├── docs/                        # Shared G2 reference docs (all projects)
│   ├── sdk-api-reference.md     # Full SDK bridge API, types, event models
│   ├── hardware-constraints.md  # Display specs, coordinate system, permissions
│   ├── development-patterns.md  # SDK quirks, event routing, lifecycle patterns
│   ├── cli-reference.md         # evenhub CLI commands and options
│   ├── dev-workflow.md          # Dev/sideload/deploy workflow
│   └── integration-ideas.md     # Feature and integration brainstorming
├── _archive/                    # Past projects (read-only reference)
│   ├── evenpilot/               # Driving HUD: speed, limit, compass, location
│   ├── even-nav/                # Earlier navigation experiment
│   └── terminal-app/            # SSH/terminal/voice app experiment
└── <project-name>/              # Active project goes here
```

---

## Hardware Constraints (G2)

| Property | Value |
|---|---|
| Display | 576 × 288 px, 4-bit greyscale (16 green shades) |
| Text lines | 10 maximum |
| Containers per page | 4 image + 8 other (12 total) |
| Input | Temple touchpad + optional R1 ring |
| Connectivity | BLE 5.2 to iPhone |
| Image tile max | 288 × 144 px |

---

## SDK Core Patterns

```typescript
import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

// Initial render — call once only
await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
  containerTotalNum: 4,
  textObject: [ /* TextContainerProperty objects */ ],
}))

// Update text without flicker
await bridge.textContainerUpgrade(new TextContainerUpgrade({
  containerID: 3,
  containerName: 'speed',
  content: '72 mph',
}))

// Exit
await bridge.shutDownPageContainer()
```

### Input Events

```typescript
const unsub = bridge.onEvenHubEvent((event) => {
  // Protobuf omits zero-value fields — CLICK_EVENT is 0, arrives as undefined
  const sysType  = event.sysEvent?.eventType  ?? -1
  const textType = event.textEvent?.eventType ?? 0   // 0 = CLICK_EVENT

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    unsub()
    bridge.shutDownPageContainer()
    return
  }

  if (textType === OsEventTypeList.CLICK_EVENT) { /* single tap */ }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) { /* swipe down */ }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT)    { /* swipe up */ }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
      sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) { unsub() }
})
```

---

## Known SDK Quirks

- **`borderRdaius` typo** — the SDK property is misspelled `borderRdaius`. Use the typo.
- **CLICK_EVENT = 0** — protobuf omits zero-value fields; tap events arrive as `undefined`. Always coerce with `?? 0`.
- **`createStartUpPageContainer` is one-shot** — call exactly once. All updates use `textContainerUpgrade`.
- **Images need a second call** — call `updateImageRawData()` separately after initial page load.
- **Throttle scroll events** — apply ~300 ms debounce to avoid request queue buildup.
- **`isEventCapture`** — exactly one container per page must set this to `1`.

---

## Starting a New Project

```bash
# From workspace root
mkdir my-project && cd my-project
npx @evenrealities/evenhub-cli init
npm install
npm run dev          # Vite dev server on 0.0.0.0:5173
npm run simulator    # Launch evenhub-simulator
npm run qr           # Sideload QR (use LAN IP, not localhost)
npx evenhub qr --url "http://192.168.x.x:5173"
```

### New Project CLAUDE.md

Each project should have its own `CLAUDE.md` describing its layout, data sources, and interactions.  
Use the workspace `docs/` folder for SDK/hardware references — don't duplicate them.

---

## Shared Documentation

| File | Contents |
|---|---|
| `docs/sdk-api-reference.md` | Full SDK bridge API, event types, container models |
| `docs/hardware-constraints.md` | Display specs, coordinate system, permissions |
| `docs/development-patterns.md` | Common patterns, SDK quirks, event routing, lifecycle |
| `docs/cli-reference.md` | evenhub CLI commands and options |
| `docs/dev-workflow.md` | Dev/sideload/deploy workflow |
| `docs/integration-ideas.md` | Feature and integration brainstorming |

---

## Past Projects (Archive)

| Project | Description |
|---|---|
| `_archive/evenpilot/` | Driving HUD: speed, speed limit, compass direction, location via GPS + Overpass + Nominatim |
| `_archive/even-nav/` | Earlier navigation experiment |
| `_archive/terminal-app/` | SSH/terminal/voice app |

---

## Key Resources

| Resource | URL |
|---|---|
| Developer Docs | https://hub.evenrealities.com/docs/getting-started/overview |
| SDK (npm) | https://www.npmjs.com/package/@evenrealities/even_hub_sdk |
| CLI (npm) | https://www.npmjs.com/package/@evenrealities/evenhub-cli |
| Templates | https://github.com/even-realities/evenhub-templates |
| Community Notes | https://github.com/nickustinov/even-g2-notes |
| Community Toolkit | https://github.com/fabioglimb/even-toolkit |
| Discord | https://discord.gg/Y4jHMCU4sv |

## Claude Code Skills (everything-evenhub plugin)

| Skill | Purpose |
|---|---|
| `/glasses-ui` | Build display layouts and containers |
| `/handle-input` | Touchpad gestures, ring, lifecycle |
| `/test-with-simulator` | Launch simulator for local debug |
| `/simulator-automation` | HTTP API for screenshots and input injection |
| `/font-measurement` | Pixel-accurate text measurement (LVGL-aligned) |
| `/sdk-reference` | Look up SDK API and types |
| `/cli-reference` | Look up CLI commands |
| `/design-guidelines` | G2 display constraints and UX best practices |
| `/background-state` | Persist state across phone background transitions |
