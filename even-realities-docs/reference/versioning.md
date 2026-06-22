# Versioning Policy

*SDK semver guarantees, deprecation windows, and how to handle min_sdk_version migrations.*

Source: https://hub.evenrealities.com/docs/reference/versioning

> **Last updated:** 2026-06-04

The Even Hub SDK follows **semantic versioning** - `MAJOR.MINOR.PATCH` - with explicit guarantees about what each bump means for your code.

## Semver contract

| Bump | Means | What can break |
| --- | --- | --- |
| **PATCH** (`0.0.10 → 0.0.11`) | Bug fix, internal refactor | Nothing in public API. Safe upgrade. |
| **MINOR** (`0.0.x → 0.1.0`) | New methods, new event types, new manifest fields | Old code keeps working. Deprecated methods may emit console warnings. |
| **MAJOR** (`0.x → 1.0`) | Breaking changes to method signatures, event payloads, or `edition` | Existing code may need migration. Follow the migration guide for that release. |

The current SDK is in the `0.x` series - the platform is signalling "not yet API-frozen." Read the release notes for every MINOR bump before upgrading production apps.

## Deprecation window

When a method or field is deprecated:

1. **N (current MINOR)** - method continues to work; logs a `[DEPRECATED]` warning in the dev console.

2. **N+1** - method continues to work; warning becomes a stack-traced error in the dev console (but no runtime failure).

3. **N+2** - method is removed. Calling it throws.

This gives you **two MINOR releases** to migrate. For example, if `oldFoo()` is deprecated in `0.2.0`, it works through `0.3.x` and is removed in `0.4.0`.

PATCH releases never deprecate anything.

## `min_sdk_version` migration

Your app's `app.json` declares `min_sdk_version`. Bumping it is a one-way trip: users on older firmware can no longer install or update to that version.

| Situation | What to set `min_sdk_version` to |
| --- | --- |
| You use only methods present in your current SDK | Match the SDK you `npm install`-ed |
| You added a new SDK method introduced in a later version | Match the version where that method first shipped |
| You hit a bug fix that's only in the latest PATCH | Bump to that PATCH version |
| You don't know which method needs which version | Run `npm list @evenrealities/even_hub_sdk` and use that version - conservative but safe |

Don't bump preemptively. Higher `min_sdk_version` strands users on older firmware.

## Reading the changelog

Every SDK release on npm includes a `CHANGELOG.md` and release notes on the dev portal. The structure:

- **Added** - new methods, events, manifest fields (safe to ignore if you don't need them)

- **Changed** - non-breaking changes to existing behavior (read for caveats)

- **Deprecated** - see deprecation window above

- **Removed** - methods removed at the end of their N+2 cycle (MAJOR bumps only)

- **Fixed** - bug fixes (read; some bug fixes alter semantics in subtle ways)

The release notes also call out any **`edition` bumps**. An `edition` change is a platform-contract change - your manifest has to declare the new edition before your app loads under it.

## Pinning vs. floating

Recommendations for `package.json`:

```json
{
  "dependencies": {
    "@evenrealities/even_hub_sdk": "0.0.10"
  }
}
```

| Strategy | When |
| --- | --- |
| **Exact pin** (`"0.0.10"`) | Production apps. Repeatable builds. Explicit upgrade decisions. |
| **Caret** (`"^0.0.10"`) | Internal demos. Picks up PATCH and MINOR automatically. Don't use for shipped apps - silent MINOR updates can introduce deprecation warnings. |
| **`latest` tag** | Discovery work only. Never in source-controlled `package.json`. |

The CLI accepts `npm install @evenrealities/even_hub_sdk@latest` to upgrade explicitly.

## Edition changes

`edition` is the platform contract your app targets - currently `"202601"`. An edition bump is a **platform-level breaking change**: bridge protocols, event names, or fundamental manifest shape have changed.

When a new edition ships:

1. The release notes call it out explicitly, with a migration guide.

2. Existing apps keep working under their old edition.

3. To opt in, set `"edition": "<new>"` in `app.json` and audit your code against the migration guide.

4. There's no auto-migration - opting in is a deliberate, per-app choice.

Edition bumps are rare - think years, not months - and well-telegraphed.

## Migration checklist

Walk through each step when bumping the SDK in an existing project:

| # | Step | Detail |
| --- | --- | --- |
| 1 | **Read the release notes** | Cover every version between your current SDK and the target. Pay attention to **Deprecated** and **Removed**. |
| 2 | **Run your test suite** | [Headless Testing](https://hub.evenrealities.com/docs/test/simulator#headless-automation) on the simulator. |
| 3 | **Test critical paths via QR sideload** | [Local Testing](https://hub.evenrealities.com/docs/test/local-testing) on real hardware. |
| 4 | **Verify against a beta build** | [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) is the only mode that gives production-equivalent behavior. Required for anything heading to release. |
| 5 | **Grep your codebase for deprecated / removed APIs** | If the release notes flagged a method, search the repo and migrate before bumping the dep. |
| 6 | **Allocate appropriately** | A MAJOR or `edition` bump is a sprint, not a side-quest. Don't bundle it with a feature. |

## Related

- [Installation](https://hub.evenrealities.com/docs/get-started/quickstart/install-tools) - current SDK version pin

- [Glossary](https://hub.evenrealities.com/docs/reference/glossary) - `edition`, `min_sdk_version`, deprecation definitions

- [Submission Flow](https://hub.evenrealities.com/docs/ship/app-submission) - state machine, reviewer rubric, fix-forward versioning rules

