# Even Hub submission requirements (all projects)

Everything that decides whether an Even Hub build is approved, in one place. Read it before starting a G2 app and again
before every submission. Items tagged **[auto]** are enforced by `src/compliance.test.ts` in `even-honyaku` (copy that
file into a new project: it runs with `npm test`). Items tagged **[you]** need a person with a phone and glasses.

**Sources and freshness.** Rules come from `even-realities-docs/` (the local mirror, synced 2026-10-16) and from the live
pages at hub.evenrealities.com/docs, read on 2026-10-19: `ship/app-submission`, `ship/packaging`, `test/beta-testing`,
`build/*`, `reference/faq`, `reference/versioning`, plus two pages the mirror does **not** have: `build/contextual-menu`
and `reference/changelog` (summarised below). The mirror has no resync script, so re-read the live
`ship/app-submission` page (last updated 2026-08-07 when checked) before each submission. At the time of writing: edition
`202601`, SDK 0.0.16, CLI 0.1.14, simulator 0.9.5, Even App floor 2.2.10 for SDK 0.0.16.

---

## 1. Process

- A build moves **Draft → Test → Submitted → Released**; the reviewer rejects Submitted → Draft with notes. Withdrawing a
  Submitted build needs support.
- **Released versions are immutable**, and in practice **a version number can be uploaded once**. Every resubmission
  (including after a rejection) needs a **new patch version** in `app.json`, `package.json` and the lockfile. Keep
  `app.json` `version` as the single source of truth and a test that the three agree.
- Reviewers install the **Submitted** build as a beta tester. Local Testing (QR sideload) dies when the phone locks, so
  it can never prove the locked-phone rules; **Beta Testing is the required gate**.
- Every decision (approve or reject) sends one email from `noreply@evenrealities.com`, subject "You have an update on
  your Even Hub App Submission", **with no outcome in it**: open the dev portal for the decision and the reviewer notes.
- Release notes (and a **non-empty changelog** for any new version) are entered on submit, one set **per
  `supported_languages` entry**.

## 2. Manifest (`app.json`)  [auto]

| Field | Rule |
| --- | --- |
| `package_id` | reverse-domain, lowercase letters/numbers only, **no hyphens or underscores**, 2+ segments, each starting with a letter. Must be unique on Even Hub (`evenhub pack -c` checks). |
| `edition` | exactly `"202601"` |
| `name` | **≤ 20 characters** and **must not contain "Even"** (any case): auto-rejected as impersonation |
| `version` | `x.y.z` only: no `v` prefix, no pre-release suffix |
| `min_sdk_version` | required; set to the SDK version you built against (floor is 0.0.14). Don't raise it needlessly: it strands users on older firmware |
| `min_app_version` | optional. The CLI **derives** it from the SDK; pack with `--sdk-ver <your SDK>` (without it the CLI uses npm's `latest`, which may differ) |
| `entrypoint` | a real file inside the built folder (`dist/index.html`) |
| `permissions` | an **array of `{ name, desc }`**, `desc` 1–300 chars, not a key/value map. `network` also has `whitelist` |
| `supported_languages` | from `en de fr es it zh ja ko`; unknown codes are rejected. Release notes are needed per entry |

## 3. Permissions  [auto + you]

Allowed names: `network`, `location`, `g2-microphone`, `phone-microphone`, `album`, `camera`.

- **Every declared permission must be used in code, and the mapping is literal** (reviewers look for the call):
  `g2-microphone` ↔ `audioControl(true, AudioInputSource.Glasses)` (write the source **explicitly**, don't rely on the
  default), `phone-microphone` ↔ `AudioInputSource.Phone`, `location` ↔ `getAppLocation` / `startAppLocationUpdates`,
  `album` ↔ `pickImageFromAlbum`, `camera` ↔ `captureImageFromCamera`. Unused permissions are flagged.
- Permission prompts fire on **first use**, not at launch.
- **Denial paths are tested** [you]: deny each permission once. The app must degrade gracefully **and tell the wearer on
  the glasses** (not only on the phone) what to do. A mic that failed to open must not leave the header saying
  "listening".

## 4. Network and CORS  [auto]

- Two independent gates: the Even app checks the `network.whitelist`, then the WebView's browser enforces **CORS**. The
  whitelist is **not** a CORS bypass. If a call works locally and fails on device, the remote API's CORS headers are wrong.
- Whitelist **full origins** only (`https://api.example.com`): no wildcards, no bare hostnames, `https`/`wss` in
  production (`http` only for a LAN dev server). One entry per origin; a WebSocket service is listed as `wss://…` (list its
  `https://` origin too if you also call it over HTTP).
- Every origin the code calls must be listed; don't list what you never call.
- Third-party APIs need `Access-Control-Allow-Origin` (and a preflight response for JSON bodies and custom headers). If you
  can't change them, proxy through a server you control and whitelist **that** domain. Anthropic needs the header
  `anthropic-dangerous-direct-browser-access: true` for browser calls.
- Load nothing from outside the bundle (no CDN scripts, fonts or images) [auto].
- Plugins are foreground-only: no network while the WebView is suspended, in-flight requests stall.

## 5. Secrets, keys and logging  [auto]

- **Never bundle an API key**: a Released `.ehpk` can be unpacked by anyone. The official guidance is a server-side proxy
  you control. Honyaku instead has **users enter their own keys** (kept in bridge storage + localStorage, sent only to the
  provider they chose, nothing bundled); say so in the privacy policy and in the review notes.
- **Never log secrets or user content.** The phone app's Developer-Mode console is visible to reviewers. Our code makes
  no `console.*` calls (tested). The SDK itself logs bridge events, **including mic audio payloads**, and its own init
  lines; that is outside our control but is why we log nothing ourselves.
- **No console errors at boot**: the buffer must be clean right after launch [you; checked in the simulator against the
  production build, not the dev server].

## 6. Packaging  [you]

```bash
npm run build
evenhub pack app.json dist -o app.ehpk --sdk-ver <exact SDK version> -c
```

- `-c` checks the `package_id` is free and **needs a logged-in CLI** (`evenhub login`; without it: "Not authenticated"), so run it from your own machine. `--enforce-manual-version` makes a **non-submittable** local build.
- Dotfiles are excluded by default. The built `entrypoint` must exist in the folder.
- **Size: the FAQ says the practical cap is about 10 MB**: larger packages still upload but install worse. Check
  `ls -l app.ehpk` every release, and keep `public/` small [auto]. **Pattern for big optional assets:** don't bundle them,
  download them on demand (whitelist the origin, pin an immutable URL such as a versioned npm file on jsDelivr, verify
  size + SHA-256, store in IndexedDB, show progress and a retry, never start the download mid-task). Honyaku does this for its 17.8 MB kuromoji romaji dictionary (Google provider only). Data only, never code, and the CDN domain must be in the whitelist **and** the privacy policy.
- **Pin the SDK exactly** in `package.json` (`"0.0.16"`, not `^`, `~` or `latest`) for shipped apps [auto]. Read the changelog
  for every `0.0.x` release before upgrading: patch releases add public surface. Run the simulator, then QR, then a beta
  build after any SDK bump.

## 7. Display and containers

- Canvas **576 × 288**, 4-bit greyscale shown as green. **No fill**: only text, borders and images structure the screen.
- Per page: ≤ 4 image + ≤ 8 other containers; **exactly one** has `isEventCapture: 1`; `containerName` ≤ 16 chars, unique;
  `containerID` unique.
- `zOrderIndex` is **all-or-nothing** per page and values must be unique. The SDK validates and fails the call locally.
- Text: ≤ 1000 chars on `createStartUpPageContainer` / `rebuildPageContainer`, ≤ 2000 on `textContainerUpgrade`;
  `textColor` 0–4 (0 may be invisible). Wrap text **yourself** (the font isn't monospaced; estimate glyph widths) so the
  glasses never re-wrap; ~10 rows maximum.
- Lists: ≤ 20 items, ≤ 64 chars each, no in-place update.
- `createStartUpPageContainer` **once**; update with `textContainerUpgrade` (IDs and names must match exactly or it
  silently no-ops); `rebuildPageContainer` only when the layout changes (flicker, loses state).
- One fixed system font: **no emoji**; unknown glyphs are silently dropped. Safe glyphs: `● ○ ■ □ ★ ☆ ▲ ▶ ▼ ◀ ━ ─ █▇▆▅▄▃▂▁
  ╭╮╯╰ │`. Kana/kanji: reported to render on hardware but not documented, so keep them optional.
- SDK quirks: the border-radius field is spelled `borderRdaius`; a tap's `eventType` is **omitted** (0), so a missing type
  means CLICK; throttle scroll events (~300 ms).

## 8. Input and gestures

| Gesture | Event | Notes |
| --- | --- | --- |
| tap | `CLICK_EVENT` (0, often omitted) | |
| double tap | `DOUBLE_CLICK_EVENT` (3) | may arrive on the sys, text or list event; detect it on **any** part |
| swipe up / down | `SCROLL_TOP_EVENT` (1) / `SCROLL_BOTTOM_EVENT` (2) | |
| long press / release | `LONG_PRESS_EVENT` (9) / `…RELEASE` (10) on `sysEvent`, SDK 0.0.14+, App 2.2.9+ | users often bind it to their own function: don't use it |
| tap, then long press | raises the OS contextual menu | OS-owned |

- **Every gesture and button must have a visible response** on the glasses. A control whose effect isn't visible (a
  setting toggled in the menu) needs a confirmation (we flash it in the header).
- The core flow must be usable **on glasses/ring alone** with the phone locked.
- The event subscription (`onEvenHubEvent`) is made **once, as early as possible, and never removed**: removing it broke
  "answer No to the exit dialog, then use the app", and a failure later in start-up must not leave the glasses without an
  exit.

## 9. Exit contract  [auto + you]

- On the **root page, a double tap must call `bridge.shutDownPageContainer(1)`** (the system confirmation) **directly**.
  - Mode **0** (immediate exit) is for internal pages after the user already confirmed. On the root it is rejected.
  - A **custom exit confirmation, or an in-app menu on double tap, is rejected**. (A doc example, "Chess", opens an in-app
    menu with an Exit item on double tap; our build with that design was **rejected**: don't copy it.)
  - Nothing is torn down before the dialog: the user may answer **No** and the app must keep working.
  - Don't add your own **Exit** item to the contextual menu: closing is a system slot.
  - A first tap of a double tap must not also trigger the single-tap action (debounce single taps ~350 ms).
- After the user confirms, the phone-side WebView must close, and the glasses must be able to launch other apps (e.g.
  Conversate, Navigate) **without a restart** [you].

## 10. Contextual menu (the OS menu, "tap then long press")

Needs SDK 0.0.14+ / Even App 2.2.9+ (older apps: items silently absent; the CLI stamps the floor).

- Declare `menuObject` on `createStartUpPageContainer` / `rebuildPageContainer`. It is **replaced wholesale**: **omitting
  it on a rebuild clears your items**, so re-send it on every rebuild [auto: Display declares it]. Items live only as long
  as the page that declared them.
- ≤ **10** items; `itemID` a **non-zero, unique uint32** (start at 1); `itemName` ≤ **32 UTF-8 bytes** (not characters: CJK
  gets ~10). The SDK rejects violations locally (`TOO_MANY_MENU_ITEMS`, `INVALID_MENU_ITEM_ID`, `DUPLICATE_MENU_ITEM_ID`,
  `INVALID_MENU_ITEM_NAME`).
- The glasses **truncate labels at about 19 characters** with "…" (seen in the simulator); the docs advise **under ~16
  ASCII characters**, one line, no wrap. Write labels as **verbs** ("Restart", "Skip"); state readouts work only by
  re-declaring the menu (a rebuild).
- Items are **fire-and-forget**: one `menuItemClickEvent { itemID }`, the menu closes, nothing can be acknowledged back.
- **Opening the menu fires `FOREGROUND_ENTER_EVENT` (4) and dismissing it `FOREGROUND_EXIT_EVENT` (5)**, with the app never
  leaving (selecting an item gives ENTER → click → EXIT). Handlers that stop timers, drop subscriptions or restart capture
  on those events run on **every menu use**: make them idempotent (we re-arm capture only if audio has actually stopped).
- System slots (Display off, Brightness, Close) are OS-owned and can change per firmware; don't address them. 5–6 items is
  the practical maximum; use the menu for actions the screen can't reach.

## 11. Lifecycle and the locked phone  [you, on a beta build]

- **iOS** WKWebView keeps running; **Android** may suspend the WebView under memory pressure (state gone, sockets dropped,
  `audioControl` capture stopped). Persist anything that matters to `localStorage` eagerly, rebuild in-memory state on
  relaunch, and **re-arm** WebSockets and mic capture on foreground (the same `AudioInputSource`). `localStorage` always
  survives (also IndexedDB, best effort); storage is per `package_id`.
- Reviewers run: phone **locked** + Even app backgrounded → the glasses-launched app renders in reasonable time (**no
  infinite spinner, no black screen**); the core flow works on glasses alone; long single-shot tasks (timers) complete;
  **alive and responsive after 2 minutes idle**; unlock → use another app → re-lock leaves the session unaffected.
- **The 5-minute locked-phone test** on a beta build is the gate: open the app in a steady state, lock for 5 minutes,
  unlock, nothing lost.

## 12. First run  [you]

- If setup is needed (API key, city, name…), the **glasses show a message that says what to do. Never a black screen.**
- Setup is **remembered** (localStorage / bridge storage): never ask twice.

## 13. Store listing (entered in the portal)

- **Display name matches `app.json` `name` and the on-glasses name** (we show the app name in the glasses header).
- **Icon**: legible; drawn in the portal's 24 × 24 editor; **1-bit** (no greys), every lit pixel inside a **2 × 2 block**
  (thinnest stroke 2 px, ~12 × 12 detail budget). **Foreground and background both supplied**, both **monochrome/greyscale**
  (colour is rejected).
- **Screenshots** must match the device: capture them with the simulator's screenshot function (`GET /api/screenshot/glasses`).
- No impersonation of existing apps, no unauthorised brand logos, no keyword stuffing in name or description.
- **Release notes**: 1–3 lines per locale, what changed **for the user** (name the symptom for hotfixes: "Fix occasional
  blank screen after returning from lock"). First version: say what the app does, not "initial release".

## 14. Privacy  [auto: presence + coverage]

- The privacy policy covers **every permission** the app requests, and documents every backend domain, traceable to the
  developer. Needs a public URL in the portal.
- Say what is stored on the device (keys, settings, anything biometric-like such as a voiceprint), where audio and text go,
  how to delete it, and that nothing is sent to the developer.
- Keep it in sync with each release: a permission or domain added without updating the policy fails review.

## 15. Content and safety

- No medical diagnosis, financial advice or emergency-routing functionality (flag for legal if unavoidable). No offensive,
  explicit, NSFW or hateful content.

## 16. Testing ladder

| Mode | Proves | Doesn't |
| --- | --- | --- |
| Simulator (`evenhub-simulator <url> --automation-port 9898`) | layout, input, logic, console | real permissions, backgrounding, BLE, the exit dialog UI |
| Local (QR) | real device, HMR | anything after the phone locks |
| Private build | real `.ehpk` install | the 5-minute lock |
| **Beta build** | everything the reviewer sees | (this is the gate) |

Simulator automation: `GET /api/screenshot/glasses` (RGBA 576×288; `alpha > 0` = lit), `GET /api/console`, `POST /api/input`
with `up|down|click|double_click|long_press|long_press_release|context_menu`. Allow ~4 s after launch. `context_menu`
toggles the OS menu. The simulator **cannot** show the exit dialog (the framebuffer simply goes blank), which system
slots appear, or real lock behaviour. Don't kill it with `pkill -f` (it matches your own shell); use the PID.

## 17. Reviewer rejection log (Honyaku)

| Version | Reviewer note | Cause | Fix |
| --- | --- | --- | --- |
| 1.1.1 | "Double-tap on the homepage needs to bring up the system confirmation dialog, which means calling `shutDownPageContainer(1)` (not `(0)`)." | We had put a menu on double tap and made its Exit call mode 0 | Double tap → `shutDownPageContainer(1)`; menu moved to the OS contextual menu |
| 1.1.3 | "`shutDownPageContainer(1)` is wrapped in a function that nothing else in the bundle calls … wire the handler up to your double-tap event branch." | The chain was connected, but the call sat behind a helper, the subscription was registered only after slow start-up steps, and a double tap was read from the first typed event part only | Call placed directly in the double-tap branch; subscribe first thing; double tap recognised on any event part; refusal retried and reported; tests with real event shapes |

If a reviewer rejects, ask what the device actually showed (dialog missing vs. dialog then failure): it tells you whether the
event never arrived or the system refused the call.

## 18. Pre-submission checklist (copy per release)

- [ ] `npm test` green, including `compliance.test.ts` **[auto]**
- [ ] new patch version in `app.json`, `package.json`, lockfile; changelog + release notes written for each locale
- [ ] `npm run build` then `evenhub pack app.json dist -o app.ehpk --sdk-ver <SDK> -c` succeeds; size noted (~10 MB cap)
- [ ] SDK pinned exactly; no `console.*`; no keys in the bundle
- [ ] `PRIVACY.md` covers every permission and domain, and is hosted at a public URL
- [ ] icon, background, screenshots (from the simulator) uploaded; display name matches
- [ ] **beta build**: 5-minute locked-phone test passes
- [ ] **beta build**: root double tap shows the system dialog; **No** leaves the app working; **Yes** closes the WebView
- [ ] **beta build**: deny each permission once; the glasses say what to do
- [ ] **beta build**: console clean at boot; app alive after 2 minutes idle; first-party app (Conversate) launches after exit
- [ ] first run with no setup shows an explanatory message on the glasses (never black), and setup persists
- [ ] every gesture/menu pick has a visible response; the OS menu opens and closing it doesn't disturb a live stream
