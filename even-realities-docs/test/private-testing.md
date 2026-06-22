# Private Testing

*Build a real .ehpk, install it on your own glasses through the dev portal, and exercise packaging, real permissions, and partial lifecycle behavior.*

Source: https://hub.evenrealities.com/docs/test/private-testing

> **Last updated:** 2026-06-04

Private Testing is the first mode where the real **packaging path** runs end to end. You build an `.ehpk` with the CLI, upload it as a **private build** in the dev portal, and install it on your own glasses through the phone app. The result behaves much closer to a Released app than the dev-server flow ever will - same install path, same manifest enforcement, same icon assets, same permission prompts.

There is **no scripted install yet**. Every iteration goes through the UI - upload, install, look. Budget around ten seconds per cycle.

> See [Test](https://hub.evenrealities.com/docs/test/) for how Private Testing compares to the simulator, local sideload, and beta builds.

## The flow

```bash
# 1. Build your production bundle
npm run build

# 2. Pack it into .ehpk
evenhub pack app.json dist -o myapp.ehpk
```

Then in the dev portal:

1. Open **hub.evenrealities.com/login**, go to your project, **Private builds** tab.

2. Upload `myapp.ehpk`.

3. On your phone, open the Even Realities App and go to the **Even Hub** tab (Developer Mode).

4. **Me → Apps → Private builds** lists your upload. Tap **Install**.

Within a few seconds the build is on your glasses. Launch it from the glasses home, the same way a Released app launches.

→ Detail: [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging)

## What Private Testing covers

- **Full `.ehpk` packaging path.** Manifest validation, icon checks, file inclusion / exclusion, all of it. If something is going to fail packaging at review time, it fails here first.

- **Real permission prompts.** The phone app prompts for permissions exactly as it will for end users. Strings, ordering, denial paths - all real.

- **Real launch UX.** Glasses launch the app from the home menu, not from a dev URL. The first-frame timing and the boot sequence are real.

- **Real install / uninstall flow.** You see what your users see when they install, including any version-update behavior.

## What Private Testing does not cover

- **No HMR.** Every code change is a full build, re-upload, re-install. Slow loop.

- **No headless automation.** There's no scripted install + run + assert path for private builds yet. Treat them as manual smoke tests, not regression harness.

- **Only partial lifecycle survival.** Private builds survive backgrounding briefly but **don't pass the 5-minute lock test** the QA reviewer runs. For that gate, use [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing).

- **No distribution to other testers.** Private builds are tied to your account. To get a build onto a colleague's phone, use Beta Testing.

## When to reach for Private Testing

- You changed the `app.json` manifest and want to verify it validates.

- You added or changed a permission and want to see the real prompt.

- You added icon assets or screenshots and want to see how they render in the install list.

- You want a smoke test that the packaged build boots before promoting to a beta.

## Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Upload rejected: "invalid manifest" | `app.json` field missing or wrong shape | Check the error detail, see [App Submission & QA → Manifest](https://hub.evenrealities.com/docs/ship/app-submission#manifest-app-json) |
| Upload rejected: "package_id taken" | Someone already claimed it | Change `package_id` to a unique reverse-DNS string you control |
| Install succeeds but glasses show black screen | Bridge call ran before `waitForEvenAppBridge()` | Check `src/main.ts` - `await` the bridge before anything else |
| Permission prompt never appears | Permission declared in `app.json` but never invoked | Permission prompts fire on first invocation, not at launch. Trigger the API path that needs the permission |
| App vanishes after lock | Backgrounded WebView killed | Expected. Use [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) for lock-survival validation |

## When to graduate to Beta Testing

Move to [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) when:

- You are within a few iterations of submitting for review.

- You need to validate the **5-minute locked-phone** behavior.

- You want a colleague to install the same build for review.

- You want reviewer-parity environment - same install path, same lifecycle, same OS treatment as a Released app.

## Related

- [Packaging & Deployment](https://hub.evenrealities.com/docs/ship/packaging) - the `.ehpk` build and manifest schema

- [App Submission & QA Guidelines](https://hub.evenrealities.com/docs/ship/app-submission) - what reviewers check

- [Beta Testing](https://hub.evenrealities.com/docs/test/beta-testing) - the next mode up

- [Background & Lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle) - why lock survival is only partial here

