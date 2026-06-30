# Foresight

A custom OS framework for Even Realities G2 smart glasses. Foresight provides a persistent HUD overlay, gesture-activated menu system, banner notifications, and sub-app container — all running within a single hosted G2 application.

**Created by:** wKey Industries  
**Developer:** ogg\_

## Capabilities

### HUD Overlay

- Persistent heads-up display at the top of the G2 screen (576×115 px)
- 2 rows × 5 columns grid of configurable component slots
- Modular components: **Clock**, **Weather**, **Reminders**
- Shared 60-second refresh cycle for all visible components
- Survives app restarts via localStorage persistence

### Clock Component

- 12-hour (h:mm AM/PM) or 24-hour (HH:mm) format
- Configurable via Web Config UI
- Placeholder display on invalid system clock

### Weather Component

- Current temperature + condition icon (☀ ⛅ ☁ 🌧 ⛈ ❄ 🌫)
- Configurable location, unit (°F/°C), and refresh interval (15–120 min)
- 24-hour cache with stale indicator on API failure

### Reminders Component

- Displays nearest upcoming reminder (title + time)
- Max 20 stored reminders
- Triggers banner notifications when reminder time is reached
- Add/delete via Web Config UI

### Menu System

- Double-tap gesture to open app launcher
- Vertical list of up to 10 sub-apps with highlight navigation
- 300ms scroll debounce, 30-second auto-dismiss
- Bounds-clamped navigation (first/last stays put)

### Banner Notifications

- Non-intrusive overlay at the top of the display
- Queue up to 5 pending notifications (drops oldest on overflow)
- Configurable duration (3–15 seconds, default 5)
- Single-tap to dismiss, auto-dismiss on timer expiry

### Sub-App Container

- Allocates 576×173 px rendering region below the HUD
- Forwards gestures to active sub-app (intercepts double-tap)
- 1-second cleanup timeout with force-release on failure
- Registry supports up to 10 sub-apps

### Web Configuration UI

- Separate browser-accessible entry point (`config.html`)
- Visual 2×5 grid editor for HUD slot assignments
- Per-component configuration forms with input validation
- Syncs to glasses via SDK localStorage bridge
- Graceful fallback when bridge is unavailable

### Application Lifecycle

- Full SDK lifecycle handling (system exit, abnormal exit, foreground transitions)
- Single `createStartUpPageContainer` call with 12 pre-allocated containers
- Pause/resume on background/foreground transitions
- `beforeunload` cleanup for bridge listeners

## Tech Stack

- **Runtime:** Even Realities G2 WebView (via `@evenrealities/even_hub_sdk`)
- **Build:** Vite 6 (multi-page: `index.html` + `config.html`)
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest + fast-check (property-based testing)

## Getting Started

### Prerequisites

- Node.js 20+ or 22+
- npm

### Install

```bash
cd even-foresight
npm install
```

### Development

```bash
# Start dev server (accessible at http://localhost:5174)
npm run dev

# Generate QR code for G2 glasses prototyping
npm run qr
```

This serves both entry points:

- `http://localhost:5174/` — G2 glasses WebView (main app)
- `http://localhost:5174/config.html` — Web Config UI

### Build

```bash
npm run build
```

Outputs to `dist/` with both entry points bundled.

### Testing

```bash
# Run all tests (single pass)
npm test

# Run tests in watch mode
npm run test:watch
```

The test suite includes 426 tests across 25 files:

- Unit tests for all modules
- 18 property-based tests validating correctness properties (100+ iterations each)
- Integration tests for lifecycle, gesture routing, and config UI

## Project Structure

```
even-foresight/
├── src/
│   ├── main.ts                  # G2 entry point, lifecycle orchestration
│   ├── gesture-router.ts        # Gesture event classification & dispatch
│   ├── constants.ts             # Display dimensions, timing values
│   ├── hud/
│   │   ├── hud-manager.ts       # HUD overlay orchestrator
│   │   ├── hud-slot.ts          # Slot position calculator & renderer
│   │   ├── types.ts             # HUD type definitions
│   │   └── components/
│   │       ├── clock.ts         # Clock HUD component
│   │       ├── weather.ts       # Weather HUD component
│   │       └── reminders.ts     # Reminders HUD component
│   ├── menu/
│   │   ├── menu-system.ts       # Menu display & navigation
│   │   └── types.ts             # Menu type definitions
│   ├── banner/
│   │   ├── banner-system.ts     # Notification queue & display
│   │   └── types.ts             # Banner type definitions
│   ├── sub-app/
│   │   ├── sub-app-container.ts # Sub-app lifecycle manager
│   │   ├── sub-app-registry.ts  # App registration & lookup
│   │   └── types.ts             # Sub-app interface definitions
│   ├── storage/
│   │   ├── storage-manager.ts   # localStorage bridge wrapper
│   │   └── schemas.ts           # Storage keys, data models, defaults
│   └── config/
│       ├── config-ui.ts         # Web config UI controller
│       ├── grid-editor.ts       # Visual HUD slot editor
│       └── config-forms.ts      # Per-component config forms
├── index.html                   # G2 app entry (minimal DOM)
├── config.html                  # Web Config UI entry point
├── app.json                     # Foresight manifest for G2 platform
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Container Allocation

The G2 display supports up to 12 containers. Foresight allocates them as:

| ID   | Purpose                             |
| ---- | ----------------------------------- |
| 0    | Banner notification overlay         |
| 1–10 | HUD slots (2 rows × 5 cols)         |
| 11   | Menu / Sub-app (shared via rebuild) |

## Gesture Routing

| Context        | single-tap     | double-tap        | swipe-up    | swipe-down    |
| -------------- | -------------- | ----------------- | ----------- | ------------- |
| Banner visible | Dismiss banner | —                 | —           | —             |
| Menu visible   | Select app     | Dismiss menu      | Navigate up | Navigate down |
| Sub-app active | Forward        | Deactivate → menu | Forward     | Forward       |
| HUD only       | —              | Open menu         | —           | —             |

## License

Proprietary — wKey Industries
