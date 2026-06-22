# Overview

*What the Even G2 is, and what you can build for it.*

Source: https://hub.evenrealities.com/docs/get-started/overview

> **Last updated:** 2026-06-11

The Even G2 is a pair of smart glasses with a dual micro-LED display - one per lens - a four-mic array, touchpads on both temples, and an optional R1 ring for extra input. It pairs with your phone over Bluetooth LE 5.2. Everything you build runs there; the glasses are the screen.

## Key hardware specs

| Spec | Value |
| --- | --- |
| **Display** | 576 x 288 px per eye |
| **Color depth** | Monochrome green, 16 levels |
| **Connectivity** | Bluetooth Low Energy 5.2 |
| **Audio input** | 4-mic array, single stream, 16 kHz PCM |
| **G2 touchpads** | Press, double press, swipe up, swipe down |
| **R1 touchpads** | Same gestures as the G2 (optional accessory) |
| **Camera / Speaker** | None |

No camera, no speaker - the omission is the point. Your code lives on the phone. The glasses render and capture input.

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
| **Design Guidelines** | [Figma: Software Design Guidelines](https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782&t=r9P3fmZ2C2glMlQ9-1) |
| **Community notes** | [GitHub: even-g2-notes](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) |
| **Community toolkit** | [GitHub: even-toolkit](https://github.com/fabioglimb/even-toolkit) |
| **Discord** | [discord.gg/Y4jHMCU4sv](https://discord.gg/Y4jHMCU4sv) |

