# Architecture

*How Even Hub apps connect your code to the Even G2 glasses.*

Source: https://hub.evenrealities.com/docs/get-started/architecture

> **Last updated:** 2026-06-11

Even Hub apps are **web apps** - HTML, CSS, and JavaScript - glued to the glasses by the Even Hub SDK. You build them on your laptop, package them up, and submit them through the dev portal for users to install.

## Connection model

```
┌──────────────────┐    HTTPS     ┌────────────────────┐   Bluetooth    ┌─────────────────────┐
│  Even Hub Cloud  │ ◄──────────► │  Phone             │ ◄────────────► │  Even G2 Glasses    │
│  (distribution   │              │  (Even Realities   │                │  (display + input)  │
│   & hosting)     │              │   App + WebView)   │                │                     │
└──────────────────┘              └────────────────────┘                └─────────────────────┘
```

- **The phone** runs the Even Realities App (Flutter), which hosts your plugin in a WebView - Chromium on Android, WKWebView on iOS. Your app logic runs inside that WebView. The Even Realities App relays everything to and from the glasses over Bluetooth.

- **The glasses** render UI containers and emit input events - presses, scrolls, swipes. Apart from native scroll handling, no app logic runs on them.

> **WARNING**
>
> **Network whitelist is not a CORS bypass**
>
> The `app.json` `network` whitelist is an **Even-side permission check** - it controls which domains your plugin is allowed to call from the WebView. It does **not** bypass CORS.
>
> In production, `fetch()` requires both:
>
>
> 1. The remote domain listed in your `app.json` `network` whitelist, **and**
>
> 2. Correct CORS headers (`Access-Control-Allow-Origin`, etc.) returned by that remote API.
>
> APIs that work on `localhost` but fail inside the WebView are almost always CORS misconfigurations on the remote side, not Even bugs. See [Networking](https://hub.evenrealities.com/docs/build/networking) for the full request flow and debugging tips.

## Testing your app

Three ways to run your app during development:

1. **QR sideload** - the CLI prints a QR pointing at your local dev server; scan it from the Even Realities App and your app loads on the glasses with hot reload.

2. **Private build** - `evenhub pack` produces an `.ehpk`; upload it through the dev portal to install on your own devices.

3. **Simulator** - preview layouts and exercise logic entirely on your laptop, no hardware needed.

## PWA as an alternative

If you'd rather stay outside the Even Hub distribution flow, build a **Progressive Web App** and point users at your hosted URL. You keep full control over distribution and hosting; you also skip the dev portal entirely - no packaging, no review.

## The SDK bridge

The SDK injects a JavaScript bridge (`EvenAppBridge`) into the WebView. Your frontend calls into it to drive the display and receive input.

**Web → Glasses:** your JS calls `bridge.callEvenApp(method, params)` → WebView bridge → Even Realities App → Bluetooth → glasses.

**Glasses → Web:** input events travel Bluetooth → Even Realities App → `window._listenEvenAppMessage(...)` → your callback.

For the project layout and a working scaffold, see [Your First App § Project structure](https://hub.evenrealities.com/docs/get-started/quickstart/first-app#_2-project-structure).

