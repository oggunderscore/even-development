# Templates

*Start from a ready-to-run template instead of scaffolding from scratch. Minimal, ASR, image, and text-heavy starters live in the official evenhub-templates repo.*

Source: https://hub.evenrealities.com/docs/get-started/quickstart/templates

> **Last updated:** 2026-06-04

[Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) is the hand-built path. **Templates** are the opposite - the bridge is wired, the input handlers are in place, and there's a working demo to edit. Reach for one when you want to ship something, not wire one from scratch.

## Where they live

All official templates live in one repo:

**[github.com/even-realities/evenhub-templates](https://github.com/even-realities/evenhub-templates)**

The README has the current list. At time of writing:

| Template | What it ships with | Reach for it when |
| --- | --- | --- |
| `minimal` | Vite + TypeScript + SDK wired in, single page, click handler | Learning the SDK; one-shot demos |
| `text-heavy` | Pagination component, large-text rendering, font-measurement helper | Reading apps, long-form content |
| `asr` | Audio capture wired, transcription scaffolding, mic UI states | Voice notes, transcription, voice control |
| `image` | Image rendering pipeline, greyscale conversion helper, placeholder swap | Photo viewers, glanceable images |

## Use one

Pull a template directly with `degit`:

```bash
npx degit even-realities/evenhub-templates/minimal my-app
cd my-app
npm install
npm run dev
```

Swap `minimal` for `text-heavy`, `asr`, or `image`. If you live in [Claude Code](https://hub.evenrealities.com/docs/AI-tooling/claude-code), the `/template` skill wraps this flow.

## What's the same in every template

- Vite + TypeScript project with HMR

- `@evenrealities/even_hub_sdk` already installed

- `app.json` manifest pre-filled with sensible defaults (you still need to edit `package_id` and `name`)

- `src/main.ts` boots the bridge with `waitForEvenAppBridge()` before any other SDK call

- A working `index.html` and `vite.config.ts` - keep both as-is

## What you edit

- `app.json` - change `package_id` (reverse-DNS, globally unique), `name`, `description`, and any `permissions` / `network` whitelist your app actually needs

- `src/` - your app logic. Each template names its own files (`pages/`, `components/`, etc.) so consult its README

- `public/icon.png` - the 24x24 greyscale app icon

## Pulling in template updates later

When the template repo ships a fix or a new feature, there is no in-place upgrader. Diff your project against the upstream folder and copy what you need. Migration notes for breaking changes live in the template's README.

## When to skip the template

- **You're learning the raw SDK.** Templates hide bridge mechanics behind helpers - do [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) at least once first.

- **Tight bundle budget.** Templates bundle demo code and helpers. Trim before shipping.

- **The template's specialty doesn't match yours.** `minimal` is rarely wrong; the others add code you may end up deleting.

## Related

- [Your First App](https://hub.evenrealities.com/docs/get-started/quickstart/first-app) - manual scaffold walkthrough

- [Display & UI System](https://hub.evenrealities.com/docs/build/display) - what containers and primitives templates compose with

- [Design Guidelines](https://hub.evenrealities.com/docs/build/design-guidelines) - styling and layout rules templates already respect

- [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - what the template lifecycle handlers automate

