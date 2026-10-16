# Packaging & Deployment

*The app.json manifest, .ehpk packaging, validation rules, and submitting to Even Hub.*

Source: https://hub.evenrealities.com/docs/ship/packaging

> **Last updated:** 2026-08-29

Shipping an Even Hub build comes down to three things: validating an `app.json` manifest, bundling assets into an `.ehpk`, and uploading it through the developer portal. The manifest schema, the CLI packaging commands, and the validation errors you're most likely to hit are all below.

Don't commit your API key

**Never bundle secrets or API keys into the `.ehpk`.** Once a build is Released, anyone can extract its contents. Move third-party keys behind a server-side proxy you control, and read environment-driven values into the bundle at build time only. This applies to every API key - third-party AI services, analytics, maps, anything.

## The `app.json` manifest

Every Even Hub app needs an `app.json` manifest. Generate a starter with:

```bash
evenhub init
```

This creates the following template:

```json
{
  "package_id": "com.example.g2demo",
  "edition": "202601",
  "name": "G2 Demo",
  "version": "0.1.0",
  "min_app_version": "2.2.6",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "network",
      "desc": "This app needs to access the network in order to ...",
      "whitelist": ["https://example.com"]
    },
    {
      "name": "location",
      "desc": "This app needs to access the location in order to ..."
    }
  ],
  "supported_languages": ["en"]
}
```

### Field reference

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `package_id` | string | Yes | Reverse-domain format (e.g., `com.yourname.appname`). Each segment must start with a **lowercase letter** and contain only **lowercase letters or numbers**. Minimum two segments. No hyphens. |
| `edition` | string | Yes | Must be `"202601"` (current edition). |
| `name` | string | Yes | **20 characters or fewer.** |
| `version` | string | Yes | Semver format: **`x.y.z`** (e.g., `"1.0.0"`). |
| `min_app_version` | string | No | Minimum Even Realities App version your build runs on. **Derived at pack time from your SDK version** - you don't set it by hand. Declare it only to pin a *stricter* floor; the CLI stamps the higher of your value and the SDK floor. See [Auto-deriving `min_app_version`](#auto-derivation). |
| `min_sdk_version` | string | Yes | Minimum SDK version required (e.g., `"0.0.14"`). |
| `entrypoint` | string | Yes | Path to your HTML entry file relative to the build folder (e.g., `"index.html"`). |
| `permissions` | array | Yes | Array of permission objects (see below). Can be empty `[]`. |
| `supported_languages` | array | Yes | Array of language codes. Valid values: `en`, `de`, `fr`, `es`, `it`, `zh`, `ja`, `ko`. |

### Permissions format

Permissions is an **array of objects**, not a key-value map. Each object:

| Key | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes | One of: `network`, `location`, `g2-microphone`, `phone-microphone`, `album`, `camera` |
| `desc` | string | Yes | Human-readable reason, **1–300 characters**. |
| `whitelist` | string[] | `network` only | List of allowed domains. Optional, defaults to `[]`. |

Example with every permission name:

```json
"permissions": [
  {
    "name": "network",
    "desc": "Fetches weather data from the API.",
    "whitelist": ["https://api.weather.com"]
  },
  {
    "name": "location",
    "desc": "Shows nearby points of interest on the display."
  },
  {
    "name": "g2-microphone",
    "desc": "Enables voice commands for hands-free control."
  },
  {
    "name": "phone-microphone",
    "desc": "Captures a voice note when the user taps record."
  },
  {
    "name": "album",
    "desc": "Lets the user pick a photo to send to the glasses."
  },
  {
    "name": "camera",
    "desc": "Lets the user capture a photo to send to the glasses."
  }
]
```

Declare only the permissions you actually use - unused entries are flagged at review.

Common mistake

`permissions` must be an **array of objects**, not a key-value map. This shape will fail validation:

```json
"permissions": { "network": ["example.com"] }
```

## Building and packing

### Step 1: Build your web app

```bash
npm run build
```

This produces your output directory (typically `dist/` or `build/`).

### Step 2: Pack into `.ehpk`

```bash
evenhub pack app.json dist -o myapp.ehpk
```

| Argument | Description |
| --- | --- |
| `app.json` | Path to your manifest file |
| `dist` | Path to your **built** output folder |
| `-o myapp.ehpk` | Output filename (defaults to `out.ehpk`) |
| `--no-ignore` | Include hidden files (dotfiles) - excluded by default |
| `-c`, `--check` | Check if your `package_id` is available on Even Hub |
| `--sdk-ver <version>` | SDK version you built against; the CLI reads its `minAppVersion` from npm and stamps it as the `.ehpk` floor. Omit to use the latest published SDK. See [Auto-deriving `min_app_version`](#auto-derivation). |
| `--enforce-manual-version` | Stamp `min_app_version` from `app.json` as-is, even below the SDK floor. Local testing only; not submittable. |

TIP

The `entrypoint` in your `app.json` must point to a file that **exists inside the build folder**. If your manifest says `"entrypoint": "index.html"` but the build folder doesn't contain `index.html`, packing will fail with:

```
Entrypoint file not found: dist/index.html
```

## Auto-deriving `min_app_version` (CLI `0.1.14+`)

`min_app_version` is the oldest Even Realities App your build can run on. You don't set it by hand - the CLI derives it from the SDK you built against and stamps it into the `.ehpk` at pack time. When an SDK release needs a newer app (a new bridge API only that app implements), that requirement ships with the SDK, so the floor stays honest without you tracking it.

Every SDK release from `0.0.13` on publishes its floor as `minAppVersion` in its npm metadata. At pack time the CLI looks it up and stamps it:

```bash
# Pin the SDK you built against (recommended)
evenhub pack app.json dist --sdk-ver 0.0.14
```

```
Stamped myapp.ehpk (30287 bytes)
min_app_version 2.2.9  (SDK 0.0.14, --sdk-ver)
```

SDK `0.0.14` publishes a floor of `2.2.9` because its contextual menu and long-press events need bridge APIs that only Even App 2.2.9 implements. Build against it and the CLI raises your floor for you.

Omitting `--sdk-ver` reads the `latest` SDK, not the one you bundled

Without `--sdk-ver`, the CLI resolves the floor from whatever npm currently tags `latest` - which may be newer than the SDK in your `package.json`. Pass `--sdk-ver <version>` matching your installed SDK for a reproducible floor. Check yours with `npm list @evenrealities/even_hub_sdk`.

### If `app.json` also declares `min_app_version`

The CLI takes the higher of your declared value and the derived SDK floor:

| Your `app.json` value | Result |
| --- | --- |
| Absent | Stamp the derived floor. |
| Equal to the floor | Stamp it - no change. |
| **Higher** than the floor | Kept - you're pinning a stricter minimum on purpose. |
| **Lower** than the floor | The floor is stamped instead, with a warning. The build still packs, but a plugin below its SDK's floor breaks on apps under it. |

```
WARNING  app.json sets min_app_version 2.0.0, below SDK 0.0.14's floor 2.2.9 (--sdk-ver).
Stamping the higher value, 2.2.9.
To stamp 2.0.0 as-is instead, re-pack with --enforce-manual-version.
Stamped myapp.ehpk (30287 bytes)
```

The CLI never rewrites your source `app.json` - the derived value is stamped into the `.ehpk` only.

### `--enforce-manual-version` (local testing only)

To stamp your `app.json` value as-is even when it's below the floor, pass `--enforce-manual-version`. This produces a **non-submittable** local build - it can fail on apps below your value and won't clear review.

```bash
evenhub pack app.json dist --sdk-ver 0.0.14 --enforce-manual-version
```

`--enforce-manual-version` requires a `min_app_version` in `app.json`; running it without one is an error.

### Offline and pre-`0.0.13` SDKs

The CLI ships a bundled `SDK → min_app_version` map as a fallback:

- **Registry unreachable** (network, DNS, timeout, 5xx) - the CLI warns and uses the bundled map. A version the map doesn't know falls back to a default floor. Re-pack online to confirm.
- **SDK `0.0.12` and older** - these predate the npm `minAppVersion` field, so the CLI prints an info line and uses the bundled map; npm versions are immutable, so those floors can't be backfilled. A version the bundled map doesn't cover falls back to the default floor.

## Troubleshooting `evenhub pack`

When packing fails, the CLI prints a specific validation error. The common ones and their fixes:

| Error you see | Fix |
| --- | --- |
| `Invalid package id` | Use lowercase reverse-domain format with at least two segments; no hyphens, no uppercase, no leading numbers. Valid: `com.myname.myapp`. Invalid: `My-App`, `com.my-app.v2`, `myapp`, `com.2fast.app`. |
| `name: must be 20 characters or fewer` | Shorten the app name. Use the `tagline` or `description` fields for longer copy. |
| `version: must be in x.y.z format` | Use three-part semver: `"1.0.0"`, not `"1.0"` or `"v1.0.0"`. |
| `min_sdk_version: expected string, received undefined` | `min_sdk_version` is required - add `"min_sdk_version": "0.0.14"` (match your installed SDK). `min_app_version` is no longer required; the CLI derives it - see [Auto-deriving `min_app_version`](#auto-derivation). |
| `SDK version not published on npm: @evenrealities/even_hub_sdk@<version>` | Your `--sdk-ver` points at a version that isn't on npm. Check the value - the CLI won't guess a floor for it. No `.ehpk` is written. |
| `--enforce-manual-version needs a min_app_version in app.json` | You passed `--enforce-manual-version` but `app.json` declares no `min_app_version`. Add one, or drop the flag to let the CLI derive the floor. |
| `permissions: each permission must be an object with "name" …` | Permissions must be an array of objects with `name` and `desc` keys. See [Permissions Format](#permissions-format) above. |
| `supported_languages: invalid language` | Use lowercase ISO codes from the supported set: `en`, `de`, `fr`, `es`, `it`, `zh`, `ja`, `ko`. |
| `Entrypoint file not found` | The file referenced by `entrypoint` must exist inside your build folder. If your Vite output goes to `dist/` and `entrypoint` is `index.html`, confirm `dist/index.html` exists. |
| `Project folder not found` | The second argument to `evenhub pack` must be an existing directory of built files. Run `npm run build` first. |

## Distribution

Once your build is Released, it surfaces inside the **Even Hub** catalog. From there:

- Users **install** it through the Even Realities App.
- They **launch** it from the glasses menu or from the app's Even Hub tab.
