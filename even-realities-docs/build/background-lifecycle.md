# Background & Lifecycle

*How your WebView is treated when the phone backgrounds the Even app or locks - iOS persists cleanly, Android may suspend under memory pressure.*

Source: https://hub.evenrealities.com/docs/build/background-lifecycle

> **Last updated:** 2026-06-08

Your app is a WebView hosted by the Even Realities App. When the phone backgrounds that app or the screen locks, iOS and Android behave very differently. Read this before you sit down for [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing).

## What the OS does to a backgrounded WebView

| Platform | Engine | When the Even app backgrounds |
| --- | --- | --- |
| **iOS** | WKWebView | **Clean.** The WebView keeps running. In-memory JS state survives. No special handling needed. |
| **Android** | Chromium WebView | **May be suspended** under memory pressure. Below the OS threshold the app keeps running; above it, the process is reclaimed and in-memory state is gone. |

The practical takeaway is Android-specific: if a piece of state matters, persist it eagerly so you can rebuild on relaunch.

## What survives, what doesn't

| Resource | On background / lock | Notes |
| --- | --- | --- |
| **`localStorage`** | Always survives (persisted to disk) | Safe for state you must not lose. |
| **In-memory JS state** | iOS: survives. Android: **may be lost** if the WebView is suspended. | Re-derive from `localStorage` on relaunch. |
| **Open WebSocket** | iOS: typically holds. Android: typically dropped if suspended. | Handle the close event; reconnect on relaunch. |
| **`audioControl(true)` capture** | Stops if the WebView is suspended | Re-enable on foreground; don't assume the stream is still live. |

> **WARNING**
>
> Treat **Android suspend** as "the app starts cold." Your code should survive both cases - persist anything important to `localStorage`, and rebuild in-memory state on relaunch.

## Why this matters for Beta Testing

The [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) lock-screen check - install as beta, **lock the phone for 5 minutes**, relaunch - exists to surface exactly these Android suspension bugs. If your app loses state, leaks a dead socket, or never re-enables capture on relaunch, it fails the check. Validate against this page first.

→ [Testing Modes](https://hub.evenrealities.com/docs/test/) · [Page Lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle) · [App Submission & QA Guidelines](https://hub.evenrealities.com/docs/ship/app-submission)

