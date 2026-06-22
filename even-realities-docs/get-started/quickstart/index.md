# Quickstart

*From zero to a running app on G2 glasses.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/

> **Last updated:** 2026-06-04

The one-page path from zero to a running app. Read it top to bottom the first time; come back to it as a checklist after that.

By the end you'll have an Even Realities account, a paired and updated pair of G2s, Developer Mode on, Node installed, and `Hello from G2!` rendering on the glasses via QR sideload.

## 1. Install the Even Realities App and register

On your phone, type this URL into your browser to download the app:

```
evenapp.evenrealities.com
```

Install the app, then register your Even Realities account inside it. The account you create here is the same one you'll use everywhere else (web hub, Developer Mode).

## 2. Log in to the web hub

Open **hub.evenrealities.com/login** and sign in with the same account.

→ Detail: [Sign in](https://hub.evenrealities.com/docs/get-started/quickstart/sign-in)

## 3. Wake the glasses out of shipping mode

New G2s arrive in **shipping mode** so the battery doesn't drain in transit. To wake them, drop both arms into the charging case with the case plugged in. The case light comes on; the glasses are ready to pair.

→ Detail: [Set up your G2 & R1](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#exit-shipping-mode)

## 4. Pair over Bluetooth and update firmware

Open the Even Realities App and walk through the in-app pairing tutorial. The app then offers a firmware update - take it before doing anything else. Most "it won't connect" reports trace back to stale firmware.

→ Detail: [Set up your G2 & R1](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#pairing)

## 5. Enable Developer Mode

Developer Mode is what unlocks QR sideload and local testing.

1. Sign in to **hub.evenrealities.com/login** with the same account as the phone app.

2. Force-quit and reopen the Even Realities App.

3. The **Even Hub** tab now shows a developer section in the top right.

→ Detail: [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode)

## 6. Install Node.js & npm

You need **Node 20 LTS or 22+**. Coming from outside the JS world? The detail page walks through nvm, fnm, Homebrew, winget, and the PATH gotchas you'll otherwise hit.

→ Detail: [Install Node.js & npm](https://hub.evenrealities.com/docs/get-started/quickstart/install-node)

## 7. Install Even Hub tooling

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

→ Detail: [Installation](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools)

## 8. Run "Hello from G2!"

Scaffold the minimal app, start the dev server, and sideload it via QR. If the phone scans the QR but the app never loads, it's almost always a firewall or Wi-Fi AP-isolation issue.

[Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) shows both routes: the hand-built Vite route installs the SDK after creating the project directory, while the template route already includes the SDK and only needs `npm install` for the template dependencies.

In a hurry? [Templates](https://hub.evenrealities.com/docs/get-started/quickstart/templates) lists ready-to-run starters from the official [evenhub-templates](https://github.com/even-realities/evenhub-templates) repo.

→ Detail: [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) · [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup)

## If you get stuck

| Symptom | Most likely cause | Where to look |
| --- | --- | --- |
| No way to find the **Scan QR** entry in the app | Developer Mode not enabled, or app not restarted after web login | [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode) |
| QR scans but app never loads | Firewall / AP isolation blocks phone-to-laptop | [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup) |
| `node` / `npm` "command not found" | PATH not set after install | [Install Node.js & npm](https://hub.evenrealities.com/docs/get-started/quickstart/install-node) |
| Glasses won't connect at all | Still in shipment mode, or stale firmware | [Set up your G2 & R1](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#set-up-your-g2-r1) |

