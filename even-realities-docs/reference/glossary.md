# Glossary

*One-line definitions for every Even Hub term that shows up in the docs, the SDK, or the dev portal.*

Source: https://hub.evenrealities.com/docs/reference/glossary

> **Last updated:** 2026-08-29

Quick lookup when a term in the docs doesn't ring a bell. Linked entries point to the deep-dive page.

## Hardware

| Term | Definition |
| --- | --- |
| **Even G2** | The smart glasses themselves - dual 576×288 monochrome green micro-LED displays, temple touchpads, four-mic array, Bluetooth 5.2. Canonical name; "G2" alone is acceptable in code/UI but spell it out in docs. |
| **Even R1** | Optional input ring - same touchpad gestures as the Even G2 temples (tap, double-tap, swipe up/down, long press). Delivered as ring input events alongside temple events. |
| **Temple touchpad** | The touch surface on each arm of the Even G2. Source of `CLICK_EVENT`, `DOUBLE_CLICK_EVENT`, `SCROLL_TOP_EVENT`, `SCROLL_BOTTOM_EVENT`, and `LONG_PRESS_EVENT` / `LONG_PRESS_RELEASE_EVENT` (SDK `0.0.14+`). |
| **Long press** | A sustained press on an Even G2 temple or Even R1 touchpad. Reaches your app as `LONG_PRESS_EVENT` then `LONG_PRESS_RELEASE_EVENT` (SDK `0.0.14+`, Even App `2.2.9+`) whenever the OS does not claim the press for its own menu. See [Device APIs → Long press](/docs/build/device-apis#long-press). |
| **Tap then long press** | The tap-followed-by-sustained-press that raises the [contextual menu](/docs/build/contextual-menu). Write it out in full whenever the menu is what is meant - not "tap and hold" or "press and hold" - and reserve plain "long press" for the SDK event pair. |
| **Charging case** | Stores and charges the Even G2. The status light (white when ready, orange briefly on insertion) is the indicator for [shipping mode](/docs/get-started/quickstart/hardware#exit-shipping-mode). |
| **Shipping mode** | Low-power state new Even G2s ship in to prevent battery drain in transit. Exit by dropping both arms into the plugged-in charging case until the case light comes on. |

## Software platform

| Term | Definition |
| --- | --- |
| **Even Hub** | The plugin platform inside the Even Realities phone app. Hosts third-party apps in a WebView and bridges them to the glasses. |
| **Even Hub SDK** | The npm package `@evenrealities/even_hub_sdk` - typed methods + event model for talking to the glasses from inside the WebView. |
| **Even Realities App** | The Flutter phone app that hosts your plugin's WebView and relays SDK calls to the glasses over Bluetooth. |
| **Developer portal** | `hub.evenrealities.com` - where you sign up, upload `.ehpk` builds, manage Beta groups, and submit for review. |
| **Developer Mode** | The Even Realities App state where developer features (Scan QR, Private/Beta install screens) are visible. There's no toggle - sign in to **hub.evenrealities.com/login** with the same account, restart the phone app, and the developer section appears in the top-right of the **Even Hub** tab. See [Enable Developer Mode](/docs/get-started/quickstart/hardware#enable-developer-mode). |
| **Bridge** | The JavaScript-to-native interface `EvenAppBridge` injected into the WebView by the SDK. Routes method calls to the phone app and events back. |

## Package format

| Term | Definition |
| --- | --- |
| **`.ehpk`** | The Even Hub package format - a zip of your built web assets plus the manifest. Produced by `evenhub pack`. The current and canonical extension; older docs/Figma may show `.ehp` or `.evenpkg` (both deprecated). |
| **`app.json`** | The manifest at the root of every Even Hub project. Declares `package_id`, `version`, `permissions`, `network` whitelist, `supported_languages`, and more. See [Packaging](/docs/ship/packaging). |
| **`edition`** | The platform-contract version your app targets. Currently `"202601"`. Bumps when the bridge or manifest schema makes a breaking change. |
| **`package_id`** | Globally unique reverse-DNS identifier for your app, e.g. `com.exampleco.exampleapp`. Lowercase letters and numbers only - no hyphens, no underscores, no uppercase. Permanent - once Released, you cannot change it. |
| **`min_sdk_version`** | The minimum SDK version your app supports. Declared in the manifest; required field. |
| **`min_app_version`** | The minimum Even Realities App version your build runs on. Optional in the manifest - the CLI derives it from your SDK version at pack time and stamps it into the `.ehpk`. A plugin whose `min_app_version` exceeds the user's app version is [blocked at open](/docs/reference/versioning#min-app-version) with an update prompt. See [Auto-deriving `min_app_version`](/docs/ship/packaging#auto-derivation). |

## Runtime concepts

| Term | Definition |
| --- | --- |
| **Page container** | A rectangular region on the glasses display that can show text, lists, or images. Apps render content by creating, updating, and destroying containers. See [Page Lifecycle](/docs/build/page-lifecycle). |
| **`createStartUpPageContainer`** | The SDK call that produces your app's initial screen. Runs exactly once at boot. |
| **`textContainerUpgrade`** | Flicker-free text update for an existing container. Use this for any in-place text refresh. |
| **`rebuildPageContainer`** | Full screen redraw - flickers on hardware. Reserve for layout changes (adding/removing containers). |
| **`shutDownPageContainer(mode)`** | Exit the app. Mode `0` = immediate; mode `1` = show the system exit-confirmation dialog (required for review). |
| **`zOrderIndex`** | Optional stacking index on list/text/image containers (SDK `0.0.12+`). Larger renders in front. All-or-nothing per page, values unique. See [Display & UI System](/docs/build/display#stacking-order-zorderindex). |
| **`textColor`** | Optional text-container brightness, levels `0`-`4` (SDK `0.0.14+`). Not a color - the display is monochrome green. Omitted on create/rebuild means device default `4`; omitted on `textContainerUpgrade` means unchanged. Distinct from `borderColor`, which is still `0`-`15`. See [Display & UI System](/docs/build/display#text-brightness). |
| **Contextual menu** | The overlay the glasses OS raises on tap then long press. Holds permanent system slots - Display off, Brightness, Close - plus up to 10 action items your app declares (SDK `0.0.14+`, Even App `2.2.9+`). See [Contextual Menu](/docs/build/contextual-menu). |
| **`menuObject`** | The contextual-menu declaration attached to `createStartUpPageContainer` / `rebuildPageContainer`. Replaced wholesale, never merged; omitting it on a rebuild **clears** the menu. |
| **`menuItemClickEvent`** | The event fired when the user selects one of your menu items. Carries the `itemID` you assigned and nothing else. Arrives on `onEvenHubEvent` regardless of which container has `isEventCapture: 1`. |

## Testing & shipping

| Term | Definition |
| --- | --- |
| **Simulator** | Desktop window that renders the glasses canvas without hardware. See [Simulator](/docs/test/simulator). |
| **QR sideload** | Run your dev server, generate a QR via the CLI, scan it with the phone app. Hot reload, but dies when the WebView backgrounds. See [Local Testing](/docs/test/local-testing). |
| **Private build** | `.ehpk` you install to your own glasses for pre-submission smoke. See [Private Testing](/docs/test/private-testing). |
| **Beta build** | `.ehpk` distributed to yourself via a Beta group - the only mode that mirrors production lifecycle. Required for clearing review. See [Beta Testing](/docs/test/beta-testing). |
| **Beta group** | A list of testers in the dev portal. Builds pushed to a group become installable by every member from their phone app's Beta tester screen. |
| **Submission state** | One of Draft, Test, Submitted, Released. See [Submission Flow](/docs/ship/app-submission). |
| **Fix-forward** | The rule that Released versions cannot be edited or rolled back - only superseded by a higher version. |

## Networking

| Term | Definition |
| --- | --- |
| **Network whitelist** | The `network` array in `app.json`. An Even-side permission check that allows your app to `fetch()` listed domains. Does not bypass CORS. |
| **CORS** | Browser-enforced. Your WebView still needs `Access-Control-Allow-Origin` headers from any remote API - the whitelist is necessary but not sufficient. |
| **AP isolation** | A Wi-Fi router feature that blocks device-to-device traffic on the same SSID. Common on corporate / guest networks. Breaks QR sideload silently. See [Network & Firewall Setup](/docs/get-started/quickstart/hardware#network-firewall-setup). |

## Tooling

| Term | Definition |
| --- | --- |
| **`evenhub` (CLI)** | The npm package `@evenrealities/evenhub-cli`. Subcommands: `init`, `qr`, `pack`. See [CLI Reference](/docs/reference/cli). |
| **`evenhub-simulator`** | The npm package `@evenrealities/evenhub-simulator`. Standalone desktop simulator. |
| **Template** | Pre-wired starter pulled from [evenhub-templates](https://github.com/even-realities/evenhub-templates) - `minimal`, `text-heavy`, `asr`, `image`. See [Templates](/docs/get-started/quickstart/templates). |

## Related

- [Versioning Policy](/docs/reference/versioning) - SDK semver rules and migration windows
- [FAQ](/docs/reference/faq) - "Can I do X?" answers
