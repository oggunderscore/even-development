# Packaging & Deployment

*The app.json manifest, .ehpk packaging, validation rules, and submitting to Even Hub.*

Source: https://hub.evenrealities.com/docs/ship/packaging

> **Last updated:** 2026-06-11

Shipping an Even Hub build comes down to three things: validating an `app.json` manifest, bundling assets into an `.ehpk`, and uploading it through the developer portal. The manifest schema, the CLI packaging commands, and the validation errors you're most likely to hit are all below.

> **WARNING**
>
> **Don't commit your API key**
>
> **Never bundle secrets or API keys into the `.ehpk`.** Once a build is Released, anyone can extract its contents. Move third-party keys behind a server-side proxy you control, and read environment-driven values into the bundle at build time only. This applies to every API key - third-party AI services, analytics, maps, anything.

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
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    {
      "name": "network",
      "desc": "This app needs to access the network in order to ...",
      "whitelist": ["https://example.com"]
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
| `min_app_version` | string | Yes | Minimum Even Realities App version required (e.g., `"2.0.0"`). |
| `min_sdk_version` | string | Yes | Minimum SDK version required (e.g., `"0.0.7"`). |
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

Example with multiple permissions:

```json
"permissions": [
  {
    "name": "network",
    "desc": "Fetches weather data from the API.",
    "whitelist": ["https://api.weather.com"]
  },
  {
    "name": "g2-microphone",
    "desc": "Enables voice commands for hands-free control."
  },
  {
    "name": "location",
    "desc": "Shows nearby points of interest on the display."
  }
]
```

> **WARNING**
>
> **Common mistake**
>
> `permissions` must be an **array of objects**, not a key-value map. This shape will fail validation:
>
>
> ```json
> "permissions": { "network": ["example.com"] }
> ```

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

> **TIP**
>
> The `entrypoint` in your `app.json` must point to a file that **exists inside the build folder**. If your manifest says `"entrypoint": "index.html"` but the build folder doesn't contain `index.html`, packing will fail with:
>
>
> ```
> Entrypoint file not found: dist/index.html
> ```

## Troubleshooting `evenhub pack`

When packing fails, the CLI prints a specific validation error. The common ones and their fixes:

| Error you see | Fix |
| --- | --- |
| `Invalid package id` | Use lowercase reverse-domain format with at least two segments; no hyphens, no uppercase, no leading numbers. Valid: `com.myname.myapp`. Invalid: `My-App`, `com.my-app.v2`, `myapp`, `com.2fast.app`. |
| `name: must be 20 characters or fewer` | Shorten the app name. Use the `tagline` or `description` fields for longer copy. |
| `version: must be in x.y.z format` | Use three-part semver: `"1.0.0"`, not `"1.0"` or `"v1.0.0"`. |
| `min_app_version / min_sdk_version: expected string, received undefined` | Both fields are required. Add `"min_app_version": "2.0.0"` and `"min_sdk_version": "0.0.7"` (match your installed SDK) to `app.json`. |
| `permissions: each permission must be an object with "name" …` | Permissions must be an array of objects with `name` and `desc` keys. See [Permissions Format](#permissions-format) above. |
| `supported_languages: invalid language` | Use lowercase ISO codes from the supported set: `en`, `de`, `fr`, `es`, `it`, `zh`, `ja`, `ko`. |
| `Entrypoint file not found` | The file referenced by `entrypoint` must exist inside your build folder. If your Vite output goes to `dist/` and `entrypoint` is `index.html`, confirm `dist/index.html` exists. |
| `Project folder not found` | The second argument to `evenhub pack` must be an existing directory of built files. Run `npm run build` first. |

## Distribution

Once your build is Released, it surfaces inside the **Even Hub** catalog. From there:

- Users **install** it through the Even Realities App.

- They **launch** it from the glasses menu or from the app's Even Hub tab.

