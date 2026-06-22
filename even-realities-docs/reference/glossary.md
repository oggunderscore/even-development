# Glossary

*One-line definitions for every Even Hub term that shows up in the docs, the SDK, or the dev portal.*

Source: https://hub.evenrealities.com/docs/reference/glossary

> **Last updated:** 2026-06-04

Quick lookup when a term in the docs doesn't ring a bell. Linked entries point to the deep-dive page.

## Hardware

| Term | Definition |
| --- | --- |
| **Even G2** | The smart glasses themselves - dual 576×288 monochrome green micro-LED displays, temple touchpads, four-mic array, Bluetooth 5.2. Canonical name; "G2" alone is acceptable in code/UI but spell it out in docs. |
| **Even R1** | Optional input ring - same touchpad gestures as the G2 temples (tap, double-tap, swipe up/down). Delivered as ring input events alongside temple events. |
| **Temple touchpad** | The touch surface on each arm of the G2. Source of `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`. |
| **Charging case** | Stores and charges the G2. The status light (white when ready, orange briefly on insertion) is the indicator for [shipping mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#exit-shipping-mode). |
| **Shipping mode** | Low-power state new G2s ship in to prevent battery drain in transit. Exit by dropping both arms into the plugged-in charging case until the case light comes on. |

## Software platform

| Term | Definition |
| --- | --- |
| **Even Hub** | The plugin platform inside the Even Realities phone app. Hosts third-party apps in a WebView and bridges them to the glasses. |
| **Even Hub SDK** | The npm package `@evenrealities/even_hub_sdk` - typed methods + event model for talking to the glasses from inside the WebView. |
| **Even Realities App** | The Flutter phone app that hosts your plugin's WebView and relays SDK calls to the glasses over Bluetooth. |
| **Developer portal** | `hub.evenrealities.com` - where you sign up, upload `.ehpk` builds, manage Beta groups, and submit for review. |
| **Developer Mode** | The Even Realities App state where developer features (Scan QR, Private/Beta install screens) are visible. There's no toggle - sign in to **hub.evenrealities.com/login** with the same account, restart the phone app, and the developer section appears in the top-right of the **Even Hub** tab. See [Enable Developer Mode](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#enable-developer-mode). |
| **Bridge** | The JavaScript-to-native interface `EvenAppBridge` injected into the WebView by the SDK. Routes method calls to the phone app and events back. |

## Package format

| Term | Definition |
| --- | --- |
| **`.ehpk`** | The Even Hub package format - a zip of your built web assets plus the manifest. Produced by `evenhub pack`. The current and canonical extension; older docs/Figma may show `.ehp` or `.evenpkg` (both deprecated). |
| **`app.json`** | The manifest at the root of every Even Hub project. Declares `package_id`, `version`, `permissions`, `network` whitelist, `supported_languages`, and more. See [Packaging](https://hub.evenrealities.com/docs/ship/packaging). |
| **`edition`** | The platform-contract version your app targets. Currently `"202601"`. Bumps when the bridge or manifest schema makes a breaking change. |
| **`package_id`** | Globally unique reverse-DNS identifier for your app, e.g. `com.exampleco.exampleapp`. Lowercase letters and numbers only - no hyphens, no underscores, no uppercase. Permanent - once Released, you cannot change it. |
| **`min_sdk_version`** | The minimum SDK version your app supports. Declared in the manifest; required field. |

## Runtime concepts

| Term | Definition |
| --- | --- |
| **Page container** | A rectangular region on the glasses display that can show text, lists, or images. Apps render content by creating, updating, and destroying containers. See [Page Lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle). |
| **`createStartUpPageContainer`** | The SDK call that produces your app's initial screen. Runs exactly once at boot. |
| **`textContainerUpgrade`** | Flicker-free text update for an existing container. Use this for any in-place text refresh. |
| **`rebuildPageContainer`** | Full screen redraw - flickers on hardware. Reserve for layout changes (adding/removing containers). |
| **`shutDownPageContainer(mode)`** | Exit the app. Mode `0` = immediate; mode `1` = show the system exit-confirmation dialog (required for review). |

## Testing & shipping

| Term | Definition |
| --- | --- |
| **Simulator** | Desktop window that renders the glasses canvas without hardware. See [Simulator](https://hub.evenrealities.com/docs/test/simulator). |
| **QR sideload** | Run your dev server, generate a QR via the CLI, scan it with the phone app. Hot reload, but dies when the WebView backgrounds. See [Local Testing](https://hub.evenrealities.com/docs/test/local-testing). |
| **Private build** | `.ehpk` you install to your own glasses for pre-submission smoke. See [Private Testing](https://hub.evenrealities.com/docs/test/private-testing). |
| **Beta build** | `.ehpk` distributed to yourself via a Beta group - the only mode that mirrors production lifecycle. Required for clearing review. See [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing). |
| **Beta group** | A list of testers in the dev portal. Builds pushed to a group become installable by every member from their phone app's Beta tester screen. |
| **Submission state** | One of Draft, Test, Submitted, Released. See [Submission Flow](https://hub.evenrealities.com/docs/ship/app-submission). |
| **Fix-forward** | The rule that Released versions cannot be edited or rolled back - only superseded by a higher version. |

## Networking

| Term | Definition |
| --- | --- |
| **Network whitelist** | The `network` array in `app.json`. An Even-side permission check that allows your app to `fetch()` listed domains. Does not bypass CORS. |
| **CORS** | Browser-enforced. Your WebView still needs `Access-Control-Allow-Origin` headers from any remote API - the whitelist is necessary but not sufficient. |
| **AP isolation** | A Wi-Fi router feature that blocks device-to-device traffic on the same SSID. Common on corporate / guest networks. Breaks QR sideload silently. See [Network & Firewall Setup](https://hub.evenrealities.com/docs/get-started/quickstart/hardware#network-firewall-setup). |

## Tooling

| Term | Definition |
| --- | --- |
| **`evenhub` (CLI)** | The npm package `@evenrealities/evenhub-cli`. Subcommands: `init`, `qr`, `pack`. See [CLI Reference](https://hub.evenrealities.com/docs/reference/cli). |
| **`evenhub-simulator`** | The npm package `@evenrealities/evenhub-simulator`. Standalone desktop simulator. |
| **Template** | Pre-wired starter pulled from [evenhub-templates](https://github.com/even-realities/evenhub-templates) - `minimal`, `text-heavy`, `asr`, `image`. See [Templates](https://hub.evenrealities.com/docs/get-started/quickstart/templates). |

## Related

- [Versioning Policy](https://hub.evenrealities.com/docs/reference/versioning) - SDK semver rules and migration windows

- [FAQ](https://hub.evenrealities.com/docs/reference/faq) - "Can I do X?" answers

