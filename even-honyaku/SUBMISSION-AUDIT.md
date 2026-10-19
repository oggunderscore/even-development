# Honyaku: Even Hub submission audit

Checked against `../SUBMISSION-CHECKLIST.md` (the rules) on 2026-10-19, at version 1.1.5. **[auto]** = enforced by
`src/compliance.test.ts`; **[sim]** = checked in the Even simulator; **[you]** = needs a beta build on real glasses and a
locked phone, which has not been done for 1.1.x.

## Found and fixed in this audit

| # | Finding | Rule | Fix |
| --- | --- | --- | --- |
| 1 | `FOREGROUND_ENTER` fires every time the OS contextual menu opens or closes, and our handler rebuilt the speech stream and mic each time, cutting off a phrase mid-sentence | contextual-menu doc: handlers on those events must be idempotent | `captureHealthy()`: re-arm only if audio has actually stopped or the stream gave up (`src/capture-health.ts`, tested) |
| 2 | The mic was opened with `audioControl(true)` (default source) | the reviewer maps `g2-microphone` to `audioControl(true, AudioInputSource.Glasses)`; unused permissions are flagged | explicit `AudioInputSource.Glasses` **[auto]** |
| 3 | SDK dependency was `^0.0.16` | versioning policy: exact pin for shipped apps | pinned to `0.0.16` in `package.json` and the lockfile **[auto]** |
| 4 | A refused mic left the glasses header saying "listening", and the error was only on the phone | permission-denial paths must tell the wearer what to do | glasses note "Mic unavailable. Check the mic permission." and listening is paused |
| 5 | Picking a setting in the OS menu changed nothing visible | every gesture needs a visible response | the new value is flashed in the glasses header |
| 6 | The glasses header said "EN<>JP", not the app name | display name must match the store name and `app.json` | header starts with "Honyaku" **[auto]** |

## Requirement by requirement

| Area | Status | Evidence |
| --- | --- | --- |
| Manifest fields, name, version, edition, entrypoint | pass | **[auto]** `compliance.test.ts`, `release.test.ts`; `evenhub pack` validates |
| Permissions declared = used (`g2-microphone`, `network`) | pass | **[auto]** |
| Network whitelist covers every origin used, nothing external loaded | pass | **[auto]**; Deepgram is listed as both `wss://` and `https://` (the docs don't say which one the whitelist checks for a WebSocket) |
| CORS on Deepgram, Google, OpenRouter, Anthropic | unverified | provider behaviour per their docs; never proven on device (**[you]**) |
| No secrets bundled, no `console.*` in our code | pass | **[auto]**; the SDK logs bridge events (including mic audio payloads) by itself |
| Console clean at boot | pass | **[sim]** production build: 0 errors, 0 warnings, 3 info lines |
| Exit: double tap → `shutDownPageContainer(1)`, called directly, never mode 0, no custom UI | pass | **[auto]**, `glasses-events.test.ts` with real event shapes, **[sim]** framebuffer blanks on double tap; the dialog itself can't be seen in the simulator (**[you]**) |
| Contextual menu: ≤ 10 items, non-zero unique ids, ≤ 32 bytes, re-declared on every rebuild | pass | `menu.test.ts`, `display.test.ts` **[sim]** |
| Contextual menu labels | acceptable | 6 items; labels ≤ 17 chars (docs advise under ~16 and verbs; ours show state, which works by rebuilding) |
| First run is never a black screen | pass | **[sim]** "Please set up Honyaku… Missing API keys" with the missing items listed; setup persisted in bridge storage + localStorage |
| Locked phone / 5-minute test / 2-minute idle | unverified | re-arm logic exists (foreground, visibility, wall-clock gap); **[you]** on a beta build |
| Permission denial paths | partial | mic refusal and network errors reach the glasses; **[you]** to confirm on device |
| Privacy policy covers every permission and domain | pass | **[auto]** `PRIVACY.md`; it needs a **public URL** for the portal |
| Store listing: icon (24×24, 1-bit, 2×2 blocks), background, screenshots | not in repo | uploaded in the portal; screenshots should come from `GET /api/screenshot/glasses` |
| Release notes per locale + changelog | drafted | `STORE-LISTING.md` |
| Content and safety | pass | translation and reply suggestions only; no medical, financial or emergency features |

## Risks that remain (decisions for the owner)

1. **Package size: 15.6 MB against a documented practical cap of about 10 MB.** The FAQ says larger packages still upload
   but degrade install; earlier 1.0.x/1.1.x uploads were accepted, but this is the likeliest "Other" rejection after the exit
   issue. Almost all of it is the 17 MB kuromoji romaji dictionary, used **only by the Google Translate provider** (the
   LLM providers write romaji themselves). Options: (a) accept; (b) drop the Google provider and the dictionary, leaving
   a package under 1 MB; (c) keep Google but romanise with a much smaller table. (b) is the simplest and removes the
   risk; it costs the free-tier provider.
2. **Keys.** The guidance is a server-side proxy; Honyaku is bring-your-own-key with nothing bundled. It has been through
   review before, but mention it in the review notes.
3. **`supported_languages` is `["en"]`** because the app UI is English. If Japanese is added, release notes are needed for it.
4. **A stale 34 KB `even-honyaku.ehpk` is tracked in git** (from an early build, ignored by `.gitignore` since). It is not what
   is shipped; consider `git rm`.
5. **Absolute asset paths** (`/assets/…`) work for every install so far; `base: './'` would be the conservative choice
   if a future host serves the app from a sub-path.
