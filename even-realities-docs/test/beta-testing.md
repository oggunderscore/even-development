# Beta Testing

*Distribute an .ehpk to yourself (or others) as a beta tester. The only mode that matches what a QA reviewer actually sees - full lifecycle, lock survival, real distribution.*

Source: https://hub.evenrealities.com/docs/test/beta-testing

> **Last updated:** 2026-06-04

Beta Testing is the only mode that behaves **identically to a Released app on a real user's phone**. You pack the `.ehpk` exactly as you would for submission, push it to a **Beta group** containing yourself (and optionally teammates), and install it from the phone app's **Beta tester** section. The OS, the lifecycle, the lock-screen behavior, the system exit dialog - all of it matches what an end user (and a QA reviewer) sees.

If you're heading into review, this is the gate. Skip it and you'll fail.

> See [Test](https://hub.evenrealities.com/docs/test/) for how Beta Testing compares to the simulator, local sideload, and private builds.

## The flow

```bash
# 1. Build and pack
npm run build
evenhub pack app.json dist -o myapp.ehpk
```

Then in the dev portal:

1. Open **hub.evenrealities.com/login**, go to your project.

2. **Beta groups** tab - create a group (e.g., `self-test`) and add your own account email. Add teammates' emails if you want them to test the same build.

3. **Builds** tab - upload `myapp.ehpk`.

4. Push the build to your `self-test` group.

On your phone (and any teammate's phone):

1. Open the Even Realities App.

2. **Me → Beta tester** lists the build.

3. Tap **Install**.

From here on, the build behaves exactly as if it were Released. Launch from glasses home, full OS lifecycle, real backgrounding.

## What only Beta Testing validates

The things you can't test anywhere else:

### The 5-minute locked-phone test

Open your app, put it in a steady state (something visible on glasses), lock the phone, wait 5 minutes, unlock. The app should still be where you left it. This is the exact test the QA reviewer runs. Private builds survive briefly but not 5 minutes; Local Testing dies the second the phone locks.

### `shutDownPageContainer(1)` system exit dialog

The system exit-confirmation dialog only renders for a real install. Root-page double-tap must call `bridge.shutDownPageContainer(1)`. Apps using `0` (immediate exit) or a custom in-app exit UI on the root page are auto-rejected at review.

### Real permission denial paths

What does your app do when the user denies a permission? Beta Testing is where you actually exercise that branch. Local Testing skips some prompts; Private Testing fires them but the reviewer's denial path is a Beta-equivalent install.

## What still requires care

- **Console logs are visible** in the phone app's Developer Mode console. Handy for debugging, but **don't log secrets** - that install path is reviewer-visible too.

- **Crashes don't auto-report** in beta yet. If your app vanishes, the console buffer is your only signal - check it immediately.

- **Beta install is a real install.** `localStorage`, IndexedDB, everything persists exactly as it would for an end user. Reset between test rounds when you need a clean state.

## The pre-submission checklist

Walk through each of these on the beta build before promoting to Submitted:

| # | Check | Pass criteria |
| --- | --- | --- |
| 1 | **5-minute locked-phone test** | Open the app, lock the phone for 5 minutes, unlock - state preserved, no spinner, no black screen. |
| 2 | **Root double-tap fires the system exit dialog** | Visible confirmation; WebView closes on confirm. |
| 3 | **Permission denial paths handled** | Deny each declared permission once - app degrades gracefully or surfaces a clear next-step message. |
| 4 | **Re-launch a first-party app (Conversate, Navigate) after exit** | Launches cleanly without restarting glasses. |
| 5 | **No console errors at boot** | Console buffer is clean immediately after launch. |

The full reviewer rubric: [App Submission & QA Guidelines](https://hub.evenrealities.com/docs/ship/app-submission).

## Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Beta tester section doesn't list the build | Account not in the group, or build not pushed to group | Re-check the portal: group membership + build assignment |
| Install succeeds, app vanishes on lock | Backgrounding kills the WebView, no resume handler | [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - persist eagerly to `localStorage` and rebuild on relaunch |
| Double-tap exits silently | `shutDownPageContainer(0)` or no exit handler | Use `shutDownPageContainer(1)` on the root page |
| Permission prompt copy is wrong | Edit `app.json` permission `desc`, repack, re-upload | Old beta still has old copy until reinstalled |
| Build updates don't propagate | Higher `min_sdk_version` than tester's firmware | Tester needs firmware update first, or you need to lower `min_sdk_version` |

## When you're done

The `.ehpk` that passed every box above is the one you submit. Move the build from **Test** to **Submitted** in the portal. The reviewer installs from your beta build's lineage - if your beta passes the 5-minute test, the reviewer almost certainly will too.

→ Next: [App Submission & QA Guidelines](https://hub.evenrealities.com/docs/ship/app-submission)

## Related

- [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging) - the build path

- [App Submission & QA Guidelines](https://hub.evenrealities.com/docs/ship/app-submission) - the reviewer rubric

- [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - what survives the 5-minute lock

