# CLI

*Even Hub CLI reference - sideloading, manifest scaffolding, packaging, and all commands.*

Source: https://hub.evenrealities.com/docs/reference/cli

> **Last updated:** 2026-08-20

The CLI (`v0.1.14`) handles QR sideloading, manifest scaffolding, and app packaging.

## Installation

Install globally so the `evenhub` binary is on your `PATH`:

```bash
npm install -g @evenrealities/evenhub-cli
```

Alternatively, pin the version per-repo:

```bash
npm install -D @evenrealities/evenhub-cli
```

> **npm:** [@evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli)

### `eh` shortcut

The CLI also installs `eh` as a shorter alias. The two are interchangeable:

```bash
eh qr --url ...    # same as: evenhub qr --url ...
eh pack app.json dist
eh init
```

## Commands

### `evenhub init`

Generate a starter `app.json` manifest in the current or specified directory.

```bash
evenhub init
evenhub init -d ./my-project
evenhub init -o ./config/app.json
```

| Option | Description |
| --- | --- |
| `-d`, `--directory <dir>` | Directory to create the file in (default: `./`) |
| `-o`, `--output <path>` | Output file path (overrides `--directory`) |

### `evenhub qr`

Generate a QR code for sideloading your app during development.

```bash
# Simplest usage - provide the full URL
evenhub qr --url "http://192.168.1.100:5173"

# Or build the URL from parts
evenhub qr -i 192.168.1.100 -p 5173 --path /my-app

# Output to a file instead of terminal
evenhub qr --url "http://192.168.1.100:5173" -e
```

| Option | Description |
| --- | --- |
| `-u`, `--url <url>` | Full URL (ignores other URL options) |
| `-i`, `--ip <ip>` | IP address or hostname |
| `-p`, `--port <port>` | Port number |
| `--path <path>` | URL path |
| `--https` | Use HTTPS instead of HTTP |
| `--http` | Use HTTP (default) |
| `-e`, `--external` | Open QR in external program instead of terminal |
| `-s`, `--scale <n>` | Scale factor for file output (default: 4) |
| `--clear` | Clear cached scheme, IP, port, and path |

Scan it with the **Even Realities App**. Your app loads on the glasses with hot reload live.

### `evenhub pack`

Package your built app into an `.ehpk` file for distribution.

```bash
evenhub pack app.json dist -o myapp.ehpk
```

| Argument / Option | Description |
| --- | --- |
| `<json>` | Path to your `app.json` manifest |
| `<project>` | Path to your built output folder (`dist`, `build`, etc.) |
| `-o`, `--output <file>` | Output filename (default: `out.ehpk`) |
| `--no-ignore` | Include hidden files (dotfiles) |
| `-c`, `--check` | Check if the `package_id` is available on Even Hub |
| `--sdk-ver <version>` | SDK version you built against; the CLI reads its `minAppVersion` from npm and stamps it as the `.ehpk` `min_app_version` floor. Omit to use the latest published SDK. |
| `--enforce-manual-version` | Stamp `min_app_version` from `app.json` as-is, even below the SDK floor. Local testing only; produces a non-submittable build. |

`min_app_version` is derived from your SDK version at pack time (CLI `0.1.14+`) - pin it with `--sdk-ver`. See [Auto-deriving `min_app_version`](/docs/ship/packaging#auto-derivation) for the resolution rules, warnings, and offline fallback.

Since `0.1.14` a failed pack exits non-zero, so a packaging step in CI fails the run instead of passing silently on a missing `.ehpk`.

See [Packaging & Deployment](/docs/ship/packaging) for the full `app.json` schema, validation rules, and troubleshooting guide.

## Shell completions

Generate completions for your shell:

```bash
evenhub --completion-bash   # Bash
evenhub --completion-zsh    # Zsh
evenhub --completion-fish   # Fish
```
