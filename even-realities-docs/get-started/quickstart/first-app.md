# Your First App

*Scaffold, code, and run a complete Hello-world Even Hub plugin - sim first, then on real glasses.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/first-app

> **Last updated:** 2026-06-04

The end state of this page:

- A Vite + TypeScript project with the SDK wired in

- A page rendering on the simulator, with a click handler

- An `app.json` manifest ready for packaging

- The same app running on real G2 glasses via QR sideload

Prerequisites: [Install Node.js & npm](https://hub.evenrealities.com/docs/get-started/quickstart/install-node), then install only the global CLI and simulator from [Install Even Hub tooling](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools). Install the SDK after creating the project in Route A, or let the template dependencies install it in Route B. For the real-hardware half of step 6, also finish [Hardware](https://hub.evenrealities.com/docs/get-started/quickstart/hardware).

## 1. Scaffold the project

Two routes - pick one.

### Route A - Create a Vite app by hand

Create a Vite + TypeScript project, install the SDK, then generate the Even Hub manifest:

```bash
npm create vite@latest my-first-app -- --template vanilla-ts
cd my-first-app
npm install
npm install @evenrealities/even_hub_sdk@latest
npx @evenrealities/evenhub-cli init
```

`evenhub init` creates `app.json`; it does not scaffold the Vite project.

### Route B - Template repo or AI tooling

Clone a ready-to-run starter from the [evenhub-templates](https://github.com/even-realities/evenhub-templates) repo:

```bash
npx degit even-realities/evenhub-templates/minimal my-first-app
cd my-first-app
npm install
```

The templates already include the SDK; `npm install` installs the template's dependencies.

[Templates](https://hub.evenrealities.com/docs/get-started/quickstart/templates) has the full list - `minimal`, `text-heavy`, `asr`, `image`. If you live in [Claude Code](https://hub.evenrealities.com/docs/AI-tooling/claude-code), the `template` skill picks and scaffolds one for you.

## 2. Project structure

A minimal Even Hub app looks like this:

```
my-first-app/
├── src/
│   └── main.ts            ← your app's entry point
├── public/
│   └── icon.png           ← greyscale app icon (24×24)
├── index.html             ← Vite HTML entry - keep as-is
├── package.json
├── vite.config.ts         ← Vite config - keep as-is for now
├── tsconfig.json
└── app.json               ← Even Hub manifest (required for packaging)
```

The only Even-specific file is `app.json` (the manifest). Everything else is standard Vite.

## 3. Write `main.ts`

Open `src/main.ts` and replace its contents with:

```typescript
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// Wait for the bridge to be ready before doing anything else.
// In the simulator this resolves immediately; on hardware it waits
// for the WebView to initialize the SDK bridge.
const bridge = await waitForEvenAppBridge()

// Build a single text container that fills the visible canvas (576×288).
const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Hello from G2!\n\nTap to count: 0\nDouble-tap to exit',
  isEventCapture: 1,           // ← receive click events on this container
})

// Render the page. `result` is 0 on success.
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

if (result !== 0) {
  console.error('createStartUpPageContainer failed:', result)
  // 1 = invalid params, 2 = oversize, 3 = out of memory
}

// Single event subscription - all OS events arrive through onEvenHubEvent.
// Inspect event.textEvent / event.listEvent / event.sysEvent to route by source.
let count = 0

bridge.onEvenHubEvent((event) => {
  const textEvent = event.textEvent
  if (!textEvent || textEvent.containerID !== 1) return

  switch (textEvent.eventType) {
    case OsEventTypeList.CLICK_EVENT:
      count += 1
      bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        content: `Hello from G2!\n\nTap to count: ${count}\nDouble-tap to exit`,
      }))
      break

    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      // Mode 1 shows the system exit-confirmation dialog -
      // required on the root page; silent exit (mode 0) is rejected in QA.
      bridge.shutDownPageContainer(1)
      break
  }
})
```

Worth knowing as you read it:

- **`waitForEvenAppBridge()`** - always await this before calling any other SDK method. Calling SDK methods before the bridge is ready silently no-ops.

- **`isEventCapture: 1`** - required if you want a container to receive input events. The default is 0 (display-only).

- **`onEvenHubEvent`** - the single subscription point for OS-to-app events. The payload's `textEvent` / `listEvent` / `sysEvent` fields tell you which kind fired; switch on `eventType` to route. See [Device APIs § Handling Events](https://hub.evenrealities.com/docs/build/device-apis#handling-events).

- **`textContainerUpgrade`** - the flicker-free way to update text. Pass a `new TextContainerUpgrade({...})`. Reserve `rebuildPageContainer` for layout changes (adding/removing containers).

- **`shutDownPageContainer(1)`** - mode `1` shows the system exit-confirmation dialog and is **required on the root page**. Apps that exit silently with mode `0` (or a custom exit UI) get rejected in QA. See [Page Lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle).

- **Result codes** - `createStartUpPageContainer` returns an int; everything else returns a boolean or a status string. See [Page Lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle).

## 4. Write the manifest (`app.json`)

The manifest lives at the project root and is required for packaging. The minimum:

```json
{
  "package_id": "com.exampleco.exampleapp",
  "name": "My First App",
  "version": "0.1.0",
  "edition": "202601",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.10",
  "entrypoint": "index.html",
  "permissions": [],
  "supported_languages": ["en"]
}
```

Field notes:

- **`package_id`** - globally unique. Convention: reverse-DNS of your handle.

- **`edition`** - the platform contract version. Use `"202601"` until told otherwise.

- **`min_app_version`** - minimum Even Realities App version required. `"2.0.0"` is the current floor.

- **`min_sdk_version`** - match the SDK you installed. Check with `npm list @evenrealities/even_hub_sdk`.

- **`permissions`** - empty for this app. To make external `fetch()` calls, add a `network` permission with a `whitelist`: `{"name": "network", "desc": "...", "whitelist": ["https://api.example.com"]}`. Microphone access uses `{"name": "g2-microphone", "desc": "..."}`. See [Packaging § Permissions Format](https://hub.evenrealities.com/docs/ship/packaging#permissions-format).

## 5. Run in the simulator

```bash
# Terminal 1 - Vite dev server
npm run dev

# Terminal 2 - Simulator (point it at the dev URL)
evenhub-simulator http://localhost:5173
```

The simulator window opens with a 576×288 green canvas. You should see:

```
Hello from G2!

Tap to count: 0
Double-tap to exit
```

Click anywhere in the canvas - the counter increments. Double-click - the system exit-confirmation dialog appears. Edit `main.ts`; Vite hot-reloads; the simulator refreshes.

### Common simulator errors

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank green canvas, no text | `waitForEvenAppBridge()` not awaited | Check that the `await` is present and `main.ts` runs at module top-level |
| Text shows but click does nothing | Container has `isEventCapture: 0` | Set `isEventCapture: 1` (and check you're switching on `OsEventTypeList.CLICK_EVENT` inside `onEvenHubEvent`, not listening for a DOM `click`) |
| `Cannot find module @evenrealities/even_hub_sdk` | SDK dependency missing | Route A: run `npm install @evenrealities/even_hub_sdk@latest`; templates: run `npm install` |
| Counter increments but text disappears | `textContainerUpgrade` was called with a wrong `containerID` / `containerName` | Both must match the values you used in `createStartUpPageContainer` |

## 6. Run on real hardware

> **Prerequisites:** the phone app has the **Scan QR** button visible (see [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode)), and the phone can reach your laptop's LAN IP (see [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup)).

Find your LAN IP, then generate a QR pointing at the dev server:

```bash
# macOS / Linux
ipconfig getifaddr en0    # macOS Wi-Fi (use en1 if blank)
hostname -I | awk '{print $1}'   # Linux

# Windows
ipconfig | findstr /i "IPv4"
```

Then:

```bash
evenhub qr --url "http://<YOUR-LAN-IP>:5173"
```

A QR code prints in the terminal. Tap **Scan QR** in the phone app and aim it at the terminal. The glasses render your app within a second. Hot-reload still works - edits to `main.ts` reflow on the glasses without re-scanning.

Tap a temple to fire the click handler - the counter increments on the glasses.

> **Known issue:** manually triggered Link jumps in **Dev Preview** mode may currently fail. Fall back to re-scanning the QR. Tracked at [Enable Developer Mode → Known issue](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#known-issue-manual-link-jump-in-dev-preview).

### Common hardware errors

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Phone says "Couldn't connect" after scan | Firewall / AP isolation | See [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup) |
| Glasses show last app, not yours | Cached app container | Re-scan the QR (forces reload) |
| App loads but click doesn't fire | Container without `isEventCapture: 1` | Same as the simulator section |
| Works in sim, blank on glasses | App tried to render before bridge ready | Confirm `await waitForEvenAppBridge()` is there |

## 7. What you have now

A working repo with:

- A Vite + TypeScript project

- A single page rendering on the glasses

- A click handler that mutates state and updates the display

- An `app.json` manifest ready for packaging

That's the minimum surface area of every Even Hub app. Multi-page navigation, audio capture, IMU, networking - all of it composes from these same primitives.

## Where to go next

Branch into whichever direction you need:

| You want to… | Read |
| --- | --- |
| Build a multi-page UI with lists and detail views | [Display & UI System](https://hub.evenrealities.com/docs/build/display) |
| Handle the R1 ring, IMU, swipes, double-taps | [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) |
| Use the microphone or local storage | [Device APIs](https://hub.evenrealities.com/docs/build/device-apis) |
| Hit an external API from your app | [Networking](https://hub.evenrealities.com/docs/build/networking) |
| Understand what happens when the phone locks | [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) |
| Lay out content for the green canvas | [Design Guidelines](https://hub.evenrealities.com/docs/build/design-guidelines) |
| Package, version, and ship | [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging) → [App Submission & QA](https://hub.evenrealities.com/docs/ship/app-submission) |
| Pick the right testing mode for what you're about to do | [Testing Modes](https://hub.evenrealities.com/docs/test/) |

