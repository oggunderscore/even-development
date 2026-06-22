# App Submission & QA Guidelines

*The full submission lifecycle - state machine, reviewer rubric, release notes, and auto-update behavior.*

Source: https://hub.evenrealities.com/docs/ship/app-submission

> **Last updated:** 2026-06-04

Shipping an Even Hub app comes down to three things: moving a build through a four-stage state machine, clearing a manual review against a fixed checklist, and accepting that Released versions are immutable. Process first, then the reviewer rubric, then release notes.

For the manifest schema and the `.ehpk` itself, see [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging).

> **WARNING**
>
> **Don't commit your API key**
>
> **Never bundle secrets or API keys into the `.ehpk`.** Once a build is Released, anyone can extract its contents. Move third-party keys behind a server-side proxy you control, and read environment-driven values into the bundle at build time only. This applies to every API key - third-party AI services, analytics, maps, anything.

## The state machine

Every build moves through four states. The transition rules are strict - there is no skipping forward and only one path backward.

```
   ┌──────────┐  upload      ┌──────┐   submit      ┌───────────┐  approve    ┌──────────┐
   │  Draft   │ ───────────► │ Test │ ───────────►  │ Submitted │ ──────────► │ Released │
   └──────────┘              └──────┘               └───────────┘             └──────────┘
        ▲                       │                         │                        │
        │       fail review     │                         │                        │
        └───────────────────────┴─────────────────────────┘                        │
                                          ▲                                        │
                                          │     publish higher version (fix-forward)│
                                          └────────────────────────────────────────┘
```

| State | Triggered by | What it means |
| --- | --- | --- |
| **Draft** | You (upload `.ehpk` to portal) | The build exists in your project. Not visible to anyone else. Editable metadata. |
| **Test** | You (move from Draft) | The build is installable as a Private build by you, and assignable to a Beta group. Still invisible publicly. |
| **Submitted** | You (move from Test) | The build is in the reviewer queue. You cannot edit metadata or content. Withdraw requires support. |
| **Released** | Even Realities reviewer | Publicly listed in the store. **No rollback** - any change requires publishing a higher version. |

## Fix-forward versioning

Once a build is **Released**, that version number is permanent. You cannot:

- Edit the manifest of a released build

- Replace the `.ehpk` of a released version

- Roll back to an earlier released version

You can only **publish a higher version** that supersedes it. Plan accordingly:

- **Bug-fix or hotfix?** Publish `0.1.1` to supersede `0.1.0`.

- **Breaking change?** Bump `min_sdk_version` so users on older firmware stay on the previous version.

- **Mistake submitted?** You can't withdraw a Released version. Publish a higher version that no-ops the broken behavior.

## Reviewer flow

When you move a build from **Test → Submitted**:

1. **Reviewer assignment** - automated.

2. **Reviewer install** - the reviewer installs the build as a beta tester (the same path you use for [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)).

3. **Reviewer test** - the rubric below.

4. **Reviewer decision** - Approve (→ Released) or Reject (→ Draft, with notes).

5. **Notifications** - both decisions email you and post to the dev portal inbox.

## What reviewers check

The reviewer's job is to confirm your build behaves like a real shipped app. The full rubric:

### Manifest (`app.json`)

- **`package_id`** - reverse-domain, lowercase, no hyphens, no underscores, ≥ 2 segments. Every segment must start with a lowercase letter (e.g. `com.acme.weather`).

- **`edition`** - exactly `"202601"` (current edition as of 2026-04-22).

- **`name`** - ≤ 20 characters and **must not contain "Even"** (case-insensitive). Names like `"EvenDoc Reader"` or `"Even Bible"` are auto-rejected as first-party impersonation. Exception: officially affiliated apps with written approval.

- **`version`** - three-part semver `x.y.z`. No `v` prefix, no pre-release suffix.

- **`min_app_version`** and **`min_sdk_version`** - both required. Current SDK floor: `"0.0.10"`.

- **`entrypoint`** - must resolve to a real file inside the build output folder.

- **`permissions`** - array of objects with `name` + `desc` (1–300 chars). `network` entries also need `whitelist`. **Not** a key-value map.

- Every requested permission must actually be **used** in app code. Unused permissions are flagged.

- **New version submissions need a non-empty changelog.**

See [Packaging & Deployment → Field Reference](https://hub.evenrealities.com/docs/ship/packaging#field-reference) for the underlying schema.

### Store listing & visual assets

- Icon is **legible** - no "black scribble" or noisy patterns.

- Both **foreground and background** are supplied (neither `null` nor empty).

- Icon and background image are **monochrome / greyscale only**. Color assets are rejected.

- Screenshots match what the app actually renders on device - capture them via the [simulator's screenshot function](https://hub.evenrealities.com/docs/test/simulator#screenshot).

- **Display name** matches `app.json` `name` *and* the on-glasses display name (no portal-vs-device mismatch).

- **No impersonation** of existing apps, no unauthorized brand logos, no keyword stuffing in name/description.

### Privacy

- Privacy policy covers **every permission** the app requests.

- Backend service domains, if any, are documented and traceable to the developer.

### First-run experience (no black screens)

- First launch from glasses when setup is needed (city, API key, player name, …) → on-glasses message **explains what to do**. **Never a black screen.**

- Setup is remembered across launches (use the [`localStorage` API](https://hub.evenrealities.com/docs/build/device-apis)) - never re-prompt the same setup.

- **CORS headers** correctly configured on any third-party API the app calls. The `app.json` network whitelist is an **Even-side permission check** - it is **not** a CORS bypass. If a request works locally but fails inside the WebView, the remote API is misconfigured for CORS, not an Even bug.

### Locked-phone operation

The G2 is designed to be useful with the phone in your pocket. Reviewers specifically test with the phone locked and the Even Realities App backgrounded.

> **Test in the right mode.** Reviewers run a **beta build via [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)**, which survives a locked phone. [Local Testing](https://hub.evenrealities.com/docs/test/local-testing) (QR sideload) **dies when the WebView backgrounds**, so it cannot validate the checks below - reproduce them with a beta build before submitting. The behaviour these checks probe is explained in [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle).

- Phone locked + Even App backgrounded → glasses-launched app renders within reasonable time. **No infinite spinner, no black screen.**

- Phone locked → the **core flow runs end-to-end on glasses + ring input alone**. Every gesture has a visible response, every button has feedback, every image loads.

- Long-running single-shot tasks (Timer, etc.) **continue and complete correctly** while the phone stays locked.

- After **2 minutes idle** the app is still alive and responsive. No freeze, no infinite loop, no crash.

- Unlock → use another phone app → re-lock - the glasses session is **unaffected**.

### Exit & lifecycle

- Root-page **double-tap calls `bridge.shutDownPageContainer(1)`** - the system exit confirmation dialog. Mode `0` (immediate exit) is **not acceptable** on the root page. A custom in-app exit confirmation UI is **not acceptable** on the root page either. Apps that exit silently or do nothing on double-tap are rejected. 
  - Reference patterns: 
    - **Make15** - root double-tap fires the system dialog directly.

    - **Chess** - root double-tap opens an in-app menu containing an "Exit" item that then calls `shutDownPageContainer(1)`.

- After the user confirms exit on glasses, the **phone-side WebView page also closes automatically**. Lingering webviews inside the Even Realities App are rejected.

- After exit, glasses can launch other apps and first-party apps (Conversate, Navigate) **without restart**. Smoke-testing with Conversate alone is sufficient.

See [Page Lifecycle](https://hub.evenrealities.com/docs/build/page-lifecycle) for page-creation and exit patterns.

### Content & safety

- **No medical diagnosis, financial advice, or emergency-routing functionality.** Flag for legal if unavoidable.

- No offensive, explicit, NSFW, or hateful content.

## Release notes

When moving to Submitted you provide release notes for each `supported_language`. Conventions:

- **Length** - 1-3 lines per locale. Reviewers and users both skim.

- **Tone** - what changed for the user, not what changed in the code.

- **First version** - describe what the app does, not "initial release."

- **Hotfixes** - name the symptom, not the commit message ("Fix occasional blank screen after returning from lock" not "fix race in onResume").

## Final pre-submission sanity check

Before clicking **Submit**, run through this short loop:

1. `evenhub pack app.json dist -o myapp.ehpk -c` - confirm `package_id` is available and the manifest validates.

2. Install as a **beta build via [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing)** and lock the phone for 5 minutes - does the app stay alive and responsive? ([Local Testing](https://hub.evenrealities.com/docs/test/local-testing) / QR sideload dies on background and will give a false failure here.)

3. Trigger a root-page double-tap - does the **system exit dialog** appear and the WebView close?

4. Re-launch a first-party app (Conversate) - does it start without restarting glasses?

5. Re-read your privacy policy - does it cover **every** permission in `app.json`?

If all five pass, you are ready to submit.

## Common confusions

| Question | Answer |
| --- | --- |
| "Why is my reviewer install showing old code?" | Reviewers install the version currently in **Submitted**. If you've made changes since, those sit in Draft - promote to Test and submit a new version. |
| "Can I demote a Released version to Test?" | No. Released is terminal. Publish a higher version. |
| "Submitted → Draft happened. What now?" | The reviewer rejected with notes. Read them, fix, then re-promote through Test → Submitted. |
| "How do I withdraw a Submitted build?" | Contact support. There's no self-serve withdrawal. |
| "Why isn't my user seeing the new version?" | Their firmware likely sits below the new `min_sdk_version`. They need a firmware update before they're eligible. |

## Related

- [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging) - the manifest schema and `.ehpk` build

- [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) - pre-submission validation

- [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - why the 5-min lock test exists

- [Versioning Policy](https://hub.evenrealities.com/docs/reference/versioning) - semver rules for the version field

