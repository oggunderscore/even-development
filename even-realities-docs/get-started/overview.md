# Overview

*What the Even G2 is, and what you can build for it.*

Source: https://hub.evenrealities.com/docs/get-started/overview

> **Last updated:** 2026-08-29

The Even G2 is a pair of smart glasses with a dual micro-LED display - one per lens - a four-mic array, touchpads on both temples, and an optional R1 ring for extra input. It pairs with your phone over Bluetooth LE 5.2. Everything you build runs there; the glasses are the screen.

## Key hardware specs

| Spec | Value |
| --- | --- |
| **Display** | 576 x 288 px per eye |
| **Color depth** | Monochrome green, 16 levels |
| **Connectivity** | Bluetooth Low Energy 5.2 |
| **Audio input** | 4-mic array, single stream, 16 kHz PCM |
| **Even G2 touchpads** | Press, double press, swipe up, swipe down, long press and release |
| **R1 touchpads** | Same gestures as the Even G2 (optional accessory) |
| **Camera / Speaker** | None |

No camera, no speaker on the glasses - the omission is the point. Your code lives on the phone; the glasses render and capture input. (Plugins can still reach the phone camera and album through the SDK when the user grants permission.)

## What you can build

Today, one surface is live: **plugins**. They are web apps, written in HTML, CSS, and JavaScript or TypeScript, glued to the glasses by the Even Hub SDK. Bring any stack - Vite, React, plain JS - the SDK takes it from there.

Three more surfaces are coming: dashboard widgets, dashboard layouts, and AI skills.

## What development looks like

```
1. Write code         Standard web app (Vite + SDK)
2. Preview locally    evenhub-simulator http://localhost:5173
3. Test on device     QR sideload, or private build in the dev portal
4. Package            evenhub pack app.json dist -o myapp.ehpk
5. Submit             Upload the .ehpk through the dev portal
```

## Quick reference

| Resource | Link |
| --- | --- |
| **SDK** | [npm: @evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk) |
| **Simulator** | [npm: @evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator) |
| **CLI** | [npm: @evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli) |
| **Design, community tools, Discord** | [Learn → Design and community resources](/docs/learn/#design-and-community-resources) |
