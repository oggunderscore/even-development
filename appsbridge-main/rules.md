# Project Rules

- Keep a tracked changelog in `CHANGELOG.md` for every app-facing change.
- Add new entries under `Unreleased` while work is in progress.
- Before publishing an APK, move the relevant `Unreleased` entries under a version heading and keep `companion-version.json` in sync with the Android build version.
- Match phone UI styling to the Even Toolkit-based G2ToTP and MotoHUD2 apps where native Android allows it.
- Android native theme ports should credit the npm package author for `even-toolkit` and note which toolkit token/component file was ported.
- Prefer existing project patterns and preserve unrelated local changes.
