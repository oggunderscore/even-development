# Foresight

A custom HUD framework for Even Realities G2 smart glasses. Foresight provides a
persistent heads-up display, a gesture-driven app launcher, banner
notifications, and a phone-side configuration app — all from a single hosted G2
application.

**Created by:** wKey Industries
**Developer:** ogg\_

> Working on the code? Read [`CLAUDE.md`](CLAUDE.md) first — it documents the
> container model, storage contract, and the constraints that are not obvious
> from reading the source.

## Architecture

Foresight is one HTML page driving two displays at once. Inside the Even
Realities phone app it runs in a WebView: the DOM is what you see and touch on
your phone, while the SDK bridge renders to the glasses. Both halves share a
single JS context and a single localStorage, so saving a setting on the phone
updates the glasses immediately — no sync protocol involved.

```
index.html
├── phone half   → src/webapp/     configuration UI on your phone screen
└── glasses half → src/glasses/    576x288 monochrome HUD
                   src/hud/, src/menu/, src/banner/
```

Opened in a plain browser there is no bridge, so only the phone half runs and
settings persist locally.

## Capabilities

### HUD

- Persistent display across the top of the glasses: **2 rows x 5 columns** of
  configurable widget slots.
- Widgets: **Clock**, **Weather**, **Reminders**.
- Shared 60-second refresh; redundant redraws are suppressed, so an unchanged
  HUD costs no BLE traffic.
- Slot text is measured against the real firmware font and truncated to fit its
  column, so widgets can never overlap or push each other off-screen.
- Layout survives restarts.

### Widgets

| Widget        | Shows                                                        |
| ------------- | ------------------------------------------------------------ |
| **Clock**     | 12-hour or 24-hour time                                       |
| **Weather**   | Temperature, condition, optional humidity                     |
| **Reminders** | Nearest upcoming reminder, and fires a banner when it is due |

Weather uses Open-Meteo (no API key). It accepts a typed location or your
device's GPS coordinates, converts cached readings when you switch °F/°C, and
falls back to a 24-hour cache with a `~` marker when the network is unavailable.

### Inactivity timer

The HUD can stay lit indefinitely (**Never Sleep**) or blank itself after a
chosen idle period (**Sleep After**, 5-60s) so it is not permanently in your
field of view. Any gesture wakes it; notifications wake it regardless.

### App launcher

Double-tap opens a vertical menu. Scroll to move, tap to select, double-tap to
dismiss; it auto-dismisses after 30 seconds. Includes an Exit entry that raises
the system exit-confirmation dialog.

### Banner notifications

Non-intrusive overlay across the top of the display. Queues up to 5, drops the
oldest on overflow, configurable 3-15 second duration, single-tap to dismiss.
The HUD is blanked while a banner is up and restored when the queue drains.

### Phone configuration app

Sign-in, a visual 2x5 grid editor for the HUD layout, per-widget settings
forms, input tuning (double-tap window), and a collapsible diagnostic log
showing exactly what the glasses firmware sent.

> Authentication is currently a local stand-in — it accepts any credentials and
> verifies nothing. It exists so the glasses can leave onboarding.

## Gesture reference

| Context        | tap            | double-tap        | swipe up/down  |
| -------------- | -------------- | ----------------- | -------------- |
| Banner visible | Dismiss banner | Dismiss banner    | —              |
| Menu open      | Select entry   | Close menu        | Move highlight |
| HUD asleep     | Wake           | Wake (no menu)    | Wake           |
| HUD awake      | —              | Open menu         | —              |

## Container allocation

The glasses page is built once and never rebuilt. G2 allows 8 non-image
containers per page; Foresight uses 7.

| ID  | Purpose                          |
| --- | -------------------------------- |
| 0-4 | HUD columns 0-4                  |
| 5   | App launcher menu                |
| 6   | Notification banner              |

## Tech stack

- **Runtime:** Even Realities G2 WebView via `@evenrealities/even_hub_sdk`
- **Text metrics:** `@evenrealities/pretext` (pixel-accurate firmware font)
- **Build:** Vite 6
- **Language:** TypeScript, strict
- **Testing:** Vitest + fast-check (property-based)

## Getting started

Requires Node.js 20+ or 22+.

```bash
npm install
```

### Development

```bash
npm run dev        # Vite + simulator together
npm run dev:vite   # Vite alone, on http://localhost:5174
npm run sim        # simulator alone (expects Vite already running)
npm run qr         # QR code for sideloading onto real glasses
```

### Build and test

```bash
npm run build      # typecheck + bundle to dist/
npm test           # single pass
npm run test:watch # watch mode
```

The suite is 460 tests across 33 files: unit tests for every module,
property-based tests for the layout, gesture, storage, and rendering
invariants, and integration tests for view navigation and bridge round-trips.

## Project structure

See [`CLAUDE.md`](CLAUDE.md) for the annotated directory map and the reasoning
behind the module boundaries.

## License

Proprietary — wKey Industries
