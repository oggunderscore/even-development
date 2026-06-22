# Claude Code

*Install the everything-evenhub plugin for Claude Code, run your first task from the terminal, and reference the full 13-skill catalog.*

Source: https://hub.evenrealities.com/docs/AI-tooling/claude-code

> **Last updated:** 2026-06-11

everything-evenhub is an open-source Claude Code plugin that teaches Claude how to build for the Even G2 - the SDK, the display constraints, the simulator, packaging, all of it. Install once; describe what you want.

> **Already using Claude Code?** Jump to [Install](#install) ↓

## What is this?

Claude Code is Anthropic's command-line AI coding tool. Instead of pasting prompts into a chat window, Claude runs in your terminal, reads your files, writes code, and runs commands. Free to try, works with the same Claude account you may already use. More at [claude.com/claude-code](https://claude.com/claude-code).

Out of the box, Claude Code knows nothing specific about the G2 platform. The plugin adds 13 skills covering the full development lifecycle:

| Tier | Skills | Purpose |
| --- | --- | --- |
| **Tier 1 - One-click** | `quickstart`, `template`, `build-and-deploy` | Scaffold a new app; package and publish |
| **Tier 2 - Core dev** | `glasses-ui`, `handle-input`, `device-features`, `background-state`, `test-with-simulator`, `simulator-automation`, `font-measurement` | Day-to-day coding tasks |
| **Tier 3 - Reference** | `sdk-reference`, `cli-reference`, `design-guidelines` | Look-up / deep-dive |

## Install

1. Install Claude Code - see [claude.com/claude-code](https://claude.com/claude-code)

2. In your terminal, add the marketplace:
```bash
/plugin marketplace add even-realities/everything-evenhub
```

3. Install the plugin:
```bash
/plugin install everything-evenhub
```

That's it - Claude picks up the skills on its own whenever your task mentions the G2.

## Try it

In Claude Code:

> Build me a hello-world app for the Even G2 glasses that shows "Hello, Even!" on the display.

Claude recognizes the request, invokes the `quickstart` skill, scaffolds the project, and walks you through running it in the simulator.

## How it works

You don't have to teach Claude about the skills or memorize their names. Each skill is a markdown file with a short description; Claude reads those descriptions and picks the right one for what you asked. Behind the scenes, the same SDK docs and design guidelines you'll find elsewhere on this site - routed through Claude's context.

## Skill catalog

Lookup table for every skill - what it does, sample prompts, and how the skills chain. Definitions live in the open-source [`even-realities/everything-evenhub`](https://github.com/even-realities/everything-evenhub) repo (`skills/`). The accordions below mirror that layout - click any skill to expand.

### Tier 1 - one-click

<details>

**`quickstart` - Scaffold a blank Even G2 app from scratch**
**Purpose:** Scaffold a **blank** Even G2 app from scratch (Vite + TypeScript + `@evenrealities/even_hub_sdk`).

**Trigger example:** `/quickstart my-weather-app` or "Build me a new Even G2 app called stopwatch."

**What it does:** Creates a fresh Vite project and wires the SDK - not a curated example app.

**Related:** → `template` (when you want a starter instead of blank), `build-and-deploy`, `glasses-ui`

</details>

<details>

**`template` - Scaffold from a curated starter via degit**
**Purpose:** Scaffold from a **curated** starter in [`even-realities/evenhub-templates`](https://github.com/even-realities/evenhub-templates) via `degit` - wiring included.

**Trigger example:** `/template my-reader --text-heavy`, `/template --asr my-transcription-app`, `/template --image photo-frame`, `/template --minimal hello-glasses`

**What it does:** Pulls `minimal`, `asr`, `image`, or `text-heavy` template; normalizes flags (`--withasr`, `--reader`, etc.); renames `package.json` / `app.json`; runs `npm install`.

**Related:** → `quickstart` (blank slate), `build-and-deploy`, `font-measurement` (for `text-heavy` pagination), [Templates](https://hub.evenrealities.com/docs/get-started/quickstart/templates) (manual flow without Claude)

</details>

<details>

**`build-and-deploy` - Package and publish to Even Hub**
**Purpose:** Package and publish your app to Even Hub.

**Trigger example:** `/build-and-deploy` or "Package my app and upload it to the dev portal."

**What it does:** Uses the Even Hub CLI to build the `.ehpk` and complete the deployment flow.

**Related:** → `quickstart`, `template`, `cli-reference`

</details>

### Tier 2 - core development

<details>

**`glasses-ui` - Build display UI (containers, text, images, lists)**
**Purpose:** Build glasses display UI - containers, text, images, lists - for the Even G2 screen.

**Trigger example:** `/glasses-ui "show a 3-item menu with a title bar"`

**What it does:** Layout and components tuned to Even G2 display constraints.

**Related:** → `handle-input`, `font-measurement`, `design-guidelines`

</details>

<details>

**`handle-input` - Touchpad gestures and ring input**
**Purpose:** Handle touchpad gestures and ring input.

**Trigger example:** `/handle-input "single press cycles screens, double press exits"`

**What it does:** Wires listeners and handlers for supported inputs.

**Related:** → `glasses-ui`, `background-state`

</details>

<details>

**`device-features` - Audio, IMU, device info, local storage**
**Purpose:** Use hardware-facing capabilities - audio capture, IMU, device info, local storage, etc.

**Trigger example:** `/device-features "toggle microphone recording on click"`

**What it does:** Interfaces with the SDK for sensors, audio, and related APIs.

**Related:** → `sdk-reference`

</details>

<details>

**`background-state` - Persist state across foreground / background**
**Purpose:** Persist plugin state across phone background / foreground when the host uses headless WebView migration.

**Trigger example:** `/background-state src/main.ts` or "My app resets when the phone comes back from background."

**What it does:** Analyzes code and inserts `setBackgroundState` + `onBackgroundRestore` from `@evenrealities/even_hub_sdk` so mutable state survives `__getStateSnapshot` / `__restoreState`.

**Related:** → `sdk-reference`, `handle-input`

</details>

<details>

**`test-with-simulator` - Run and debug in the simulator**
**Purpose:** Run and debug the app in the Even Hub Simulator.

**Trigger example:** `/test-with-simulator "debug my app with glow effect"`

**What it does:** Launches the local simulator workflow for the current project.

**Related:** → `simulator-automation`

</details>

<details>

**`simulator-automation` - Drive the simulator over HTTP**
**Purpose:** Drive the simulator over its HTTP API - screenshots, input injection, console logs.

**Trigger example:** `/simulator-automation "take a screenshot and verify text is displayed"`

**What it does:** Automates simulator actions for repeatable checks.

**Related:** → `test-with-simulator`

</details>

<details>

**`font-measurement` - Pixel-accurate text and list measurement**
**Purpose:** Pixel-accurate text and list measurement aligned with LVGL firmware rendering.

**Trigger example:** `/font-measurement "size a text container for a long paragraph with 8px padding"`

**What it does:** Measurement utilities for layout that matches on-device text metrics.

**Related:** → `glasses-ui`

</details>

### Tier 3 - reference

<details>

**`sdk-reference` - Look up SDK APIs, types, patterns**
**Purpose:** Look up Even Hub SDK APIs, types, and patterns.

**Trigger example:** `/sdk-reference createStartUpPageContainer`

**What it does:** Surfaces SDK documentation for the symbol or topic you name.

**Related:** → `device-features`, `background-state`

</details>

<details>

**`cli-reference` - Look up Even Hub CLI commands and flags**
**Purpose:** Look up Even Hub CLI commands and flags.

**Trigger example:** `/cli-reference evenhub qr`

**What it does:** Usage and examples for CLI tooling (`evenhub`, packaging, QR, etc.).

**Related:** → `build-and-deploy`

</details>

<details>

**`design-guidelines` - Display constraints and UX best practices**
**Purpose:** Even G2 display design constraints and UX best practices.

**Trigger example:** `/design-guidelines settings screen with 5 options`

**What it does:** Design specs and guidance for readable, consistent glasses UI.

**Related:** → `glasses-ui`

</details>

### Harness testing

The plugin repo ships a **harness** runner that regression-tests skills with an AI agent. Example:

```bash
/harness quickstart
```

See [`harness/README.md`](https://github.com/even-realities/everything-evenhub/blob/main/harness/README.md) for how to add tests for new skills.

