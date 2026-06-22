# Local Testing

*Run your dev server on your laptop, sideload it to real glasses via QR, and iterate with hot module reload.*

Source: https://hub.evenrealities.com/docs/test/local-testing

> **Last updated:** 2026-06-04

Local Testing is the daily driver for on-device development. Your Vite dev server runs on your laptop, the CLI prints a QR pointing at it, you scan from the phone app, and the app is rendering on the real G2 a second later - with **hot module reload** live. Edit a file, save, the change reflows on glass.

The fastest way to iterate on hardware. Also the most fragile if your network gets in the way.

> See [Test](https://hub.evenrealities.com/docs/test/) for how Local Testing compares to the simulator, private builds, and beta builds.

## The flow

```bash
# Terminal 1 - your project's dev server
npm run dev

# Terminal 2 - generate a QR pointing at your LAN IP
evenhub qr --url "http://<your-lan-ip>:5173"
```

Open the **Even Hub** tab in the Even Realities phone app (you enabled this in [Hardware → Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode)), tap **Scan QR**, and aim the phone camera at the terminal. Within a second the glasses render your app.

Edit `src/main.ts`, save, and the glasses redraw without re-scanning.

→ Detail: [Your First App § On Real Hardware](https://hub.evenrealities.com/docs/get-started/quickstart/first-app#_6-run-on-real-hardware) · [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup)

## What makes Local Testing fast

- **HMR works.** Vite pushes module updates over WebSocket; the WebView re-evaluates the changed module and your page re-renders.

- **Real BLE timing.** Unlike the simulator, you see actual phone-to-glasses latency.

- **Real input.** Temple touches and R1 ring events come through exactly as they would in production.

- **Real device APIs.** Microphone, IMU, battery readings are live.

## What Local Testing does not cover

- **Backgrounding.** The moment the phone backgrounds the Even Realities App - lock screen, app switcher, Control Center on iOS - the WebView is suspended. The dev WebSocket dies. When the WebView resumes you usually get a blank screen until you re-scan the QR. That's how phone WebViews behave everywhere; it isn't an Even bug.

- **Packaging path.** Nothing here builds an `.ehpk`. Manifest errors, packaging validation, icon assets - all skipped.

- **Real permissions.** Some permission prompts are skipped during dev.

- **Reviewer parity.** The QA gate explicitly tests with a locked phone. Local Testing dies the moment the phone locks, so it can't validate what reviewers look for. Run [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) before submitting.

## HMR recovery

HMR over BLE-indirect WebView is brittle. A few patterns help when it stalls:

- **Re-scan the QR.** Forces a full page reload - the nuclear option when nothing else clears it.

- **Pin the HMR host.** In `vite.config.ts`:
```typescript
export default defineConfig({
  server: {
    host: true,                // accept connections from any interface
    hmr: { host: '<your-lan-ip>' }
  }
})
```

This stops HMR from trying to talk back to `localhost`, which the phone can't reach.

- **Watch for `(disconnected)` in the WebView console.** Open the dev console from the phone app's Developer Mode screen. If you see WebSocket failures, that's HMR. The page itself usually keeps working until you save the next change.

## Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Phone says "Couldn't connect" after scan | Firewall blocking inbound on dev port | [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup) |
| Phone scans but nothing happens, no error | Wi-Fi AP isolation blocks phone-to-laptop | [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup) |
| Works at home, fails at the office | Office Wi-Fi has client isolation | Switch to phone hotspot or Tailscale |
| Page loads but blank screen | `await waitForEvenAppBridge()` missing | Check `src/main.ts` |
| Page loads, no click response | Container without `isEventCapture: 1` | [Display & UI System](https://hub.evenrealities.com/docs/build/display) |
| App works once, blank on next change | HMR WebSocket dead - resume after background | Re-scan the QR |

## When to graduate

Local Testing carries you through almost all UI and input work. Move to:

- **[Private Testing](https://hub.evenrealities.com/docs/test/private-testing)** when you need to test the actual `.ehpk` build, manifest validation, or real permissions.

- **[Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)** when you're heading into review and need to validate the locked-phone behavior reviewers test.

## Related

- [Simulator](https://hub.evenrealities.com/docs/test/simulator) - no-hardware iteration with optional headless API

- [Private Testing](https://hub.evenrealities.com/docs/test/private-testing) - first time you build a real `.ehpk`

- [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) - reviewer-parity, required before submission

- [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - why Local Testing dies on background

