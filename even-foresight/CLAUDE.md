# Foresight — Working Notes

Custom HUD "OS" for the Even Realities G2. Read this before changing anything;
it records the constraints and past mistakes that are not obvious from the code.

The workspace-level `../CLAUDE.md` covers the G2 platform in general and
`../even-realities-docs/` is the authoritative SDK mirror. This file is only
about **this** project.

---

## The one-page mental model

Foresight is **a single HTML page that drives two displays at once.**

```
index.html  (one WebView, hosted by the Even Realities phone app)
├── phone half  → the DOM the wearer touches on their phone
│                 src/webapp/*, entered via src/webapp/phone-ui.ts
└── glasses half → the 576x288 monochrome display, driven via the SDK bridge
                  src/glasses/*, src/hud/*, src/menu/*, src/notification/*,
                  src/sub-app/*, src/smarter-everyday/*
```

Both halves run **in the same JS context and share one localStorage.** That is
the single most important fact about this codebase. It means:

- The phone does not "send" config to the glasses. It writes storage and
  dispatches a `foresight-config-changed` DOM event that the glasses half is
  listening for in the same document.
- There is no IPC, no polling loop, no serialization boundary between them.
- A crash in the glasses half leaves the phone UI running, and vice versa.

`src/main.ts` is only a boot file: detect environment → mount phone UI → start
glasses runtime. Put logic in the halves, not in `main.ts`.

---

## Container allocation — the rule that matters most

The glasses page is built **once**, by a single `rebuildPageContainer` in
`src/glasses/home-screen.ts`, and every later update is an in-place
`textContainerUpgrade`.

| ID  | Name        | Region             | Purpose                       |
| --- | ----------- | ------------------ | ----------------------------- |
| 0-4 | `hud-col-N` | y=0, 115x54 each   | HUD columns 0-4               |
| 5   | `menu`      | y=64, 576x224      | App launcher (`isEventCapture`) |
| 6   | `banner`    | y=0, 576x54        | Notifications, drawn on top   |
| 7   | `subapp`    | y=115, 576x173     | Active `SubApp`'s render surface |

Defined once in `src/constants.ts` (`CONTAINER`, `CONTAINER_NAME`). Never
hard-code a container ID anywhere else.

**All 8 non-image containers are now allocated.** A new surface has to share an
existing container rather than add one — and sharing needs care, because the
notification system already borrows `menu` for the Notification_Center. That is
why the sub-app got its own container instead: returning to the notification
system's idle phase blanks whatever it borrowed, which would have silently
erased an active sub-app's view. `notification-system.ts` renders the *diff*
between the outgoing and incoming phase for exactly this reason, so it never
blanks a container the outgoing phase did not write to (that is what keeps an
open `menu` intact when a banner auto-dismisses over it).

> **Never call `rebuildPageContainer` outside `home-screen.ts`.**
>
> A rebuild replaces the *entire page* and destroys every container. The menu
> used to rebuild the page to show itself, which silently deleted HUD columns
> 1-4 — so the HUD went permanently blank the first time you opened the menu,
> and every later `textContainerUpgrade` to those IDs no-oped. If you need a
> new surface, add a container to `buildPageContainers()` instead. G2 allows 8
> non-image containers per page; all 8 are used.

Other container facts learned the hard way:

- **Exactly one** container may set `isEventCapture: 1`. It is the menu, because
  that is the only surface long enough to need firmware overflow scrolling.
  Input events are delivered to the app regardless of which container holds it.
- `containerName` is capped at **16 characters** and must be unique per page.
- Overlap compositing is unspecified under the legacy rule. The banner overlaps
  the HUD band, so rather than trusting it, showing a banner explicitly blanks
  the HUD (`onVisibilityChange` → `hud.setVisible(false)`) and restores it after.

### `zOrderIndex` (SDK 0.0.12+) — not used yet

SDK 0.0.12 added an explicit `zOrderIndex` on text/list/image containers:
larger renders in front. Foresight is pinned to `^0.0.10` and sets it nowhere,
so the page follows the legacy rule — later declarations draw on top — which is
why the banner is declared last.

It is **all-or-nothing per page**: the moment one container sets it, every
text/list/image container must, with unique values and no tie-break. So if you
adopt it, `buildPageContainers()` has to set it on all eight at once. Doing so
would let the banner overlap the HUD without the explicit blank/restore dance,
but that dance is deterministic and cheap, so this is an option rather than a
fix. See `../even-realities-docs/build/display.md`.

## The 2x5 grid is really 5 containers

The HUD is a **2 rows x 5 columns** grid to the user, but only **5 containers**
exist. Row 0 renders on line 1 of a column, row 1 on line 2.

Consequences:

- `HUD_HEIGHT` is exactly `2 * TEXT_LINE_HEIGHT` (54px). LVGL's line height is a
  fixed 27px.
- **Every slot's text must fit one line.** `fitToColumn()` in `hud/hud-slot.ts`
  measures against the real firmware font (`@evenrealities/pretext`) and
  truncates to 115px. Without it a wide row-0 value wraps and pushes row 1 out
  of the container — the widget just disappears. `"78°F P.Cloudy"` measured
  121px, which is why the condition label is now `PtCldy`.
- Do not size HUD text by character count. The font is proportional; measure.

---

## Layout / directory map

```
src/
├── main.ts                  boot only — environment detect, wire the two halves
├── constants.ts             display geometry, container IDs, all timing values
├── glasses/                 the glasses half
│   ├── runtime.ts           splash → hydrate storage → onboarding or home
│   ├── home-screen.ts       page allocation, input routing, inactivity timer
│   ├── input-router.ts      raw SDK events → tap / double-tap / scroll
│   └── layout.ts            webapp storage shapes → glasses shapes (pure)
├── hud/
│   ├── hud-manager.ts       owns slot components + the 60s refresh cycle
│   ├── hud-slot.ts          column geometry, write memoization, fitToColumn
│   └── components/          clock, weather, reminders
├── menu/menu-system.ts      app launcher (writes container 5, never rebuilds)
├── notification/            replaced banner/ — see "Notifications" below
│   ├── notification-state-machine.ts  pure transition(); all phase logic
│   └── notification-system.ts         bridge/timers/storage around it
├── sub-app/                 the SubApp SDK — see docs/SUBAPP_GUIDE.md
│   ├── types.ts             SubApp / SubAppContext / SubAppContainer contract
│   ├── sub-app-registry.ts  register() at boot, capped at MENU_MAX_ENTRIES
│   └── sub-app-container.ts lifecycle + gesture forwarding (writes container 7)
├── smarter-everyday/        topic manager, scheduler, content generator, SubApp
├── gesture-router.ts        pure routeGesture + classifyPress (not fully wired)
├── press-adapter.ts         press-start/press-end spike for the hold gesture
├── screens/welcome.ts       first-run onboarding, polls for phone login
├── storage/
│   ├── schemas.ts           ALL storage keys + data shapes (single source)
│   └── storage-manager.ts   sync read cache over the async bridge
├── user/user-store.ts       profile record
└── webapp/                  the phone half — one file per view
    ├── phone-ui.ts          auth screens + post-login shell
    ├── view-router.ts       mount/unmount one view at a time
    ├── storage-helpers.ts   loadConfig / saveConfig (bridge + localStorage)
    └── types.ts             webapp types; STORAGE_KEYS re-exported from schemas
```

---

## Storage

**All keys live in `src/storage/schemas.ts`.** `webapp/types.ts` re-exports them
rather than redeclaring — the two were once independent literals, which let the
phone and the glasses disagree about which key held what.

Two independent stores are kept in sync:

| Store              | Written by                     | Survives     |
| ------------------ | ------------------------------ | ------------ |
| Bridge localStorage | `saveConfig`, `StorageManager` | the real app |
| Browser localStorage | same, mirrored                | page reloads |

`StorageManager.loadKey` reads the bridge first and falls back to browser
localStorage, re-seeding the bridge when it finds a value there. This is not
just belt-and-braces: **the simulator's bridge store is in-memory and empties on
reload**, so without the fallback the glasses come back up with no config while
the phone UI still shows it, which looks like the settings were lost.

### Adding a config value — the checklist

1. Add the key to `STORAGE_KEYS` in `storage/schemas.ts`.
2. **Add it to `HYDRATED_KEYS` in `glasses/runtime.ts`** if the glasses read it.
   `StorageManager.get()` is synchronous and reads a cache; bridge reads are
   async. A key not hydrated at startup reads as `null` forever.
3. Handle it in `HomeScreen.applyConfigChange()` so a live save takes effect
   without a restart.
4. Save it from the phone with `saveConfig()`, which writes both stores and
   fires the event.

### StorageManager: `set` vs `setCached`

- `set()` — writes cache + both stores. Use when the glasses half is the author
  (weather cache, completed reminders).
- `setCached()` — cache only. Use when the phone already persisted it; a `set()`
  there is a redundant round trip that can race the phone's own write.

---

## Input

`glasses/input-router.ts` turns raw SDK events into four gestures.

- **`CLICK_EVENT` is `0`, and protobuf omits zero-valued fields.** A real tap
  arrives as `{ textEvent: {} }` with `eventType` undefined. Any classifier that
  checks `eventType === 0` alone will miss every tap.
- A bare `sysEvent` is **not** a tap. Treating it as one made the HUD react to
  lifecycle notifications.
- **Double-taps are synthesised in software.** The firmware does not reliably
  emit `DOUBLE_CLICK_EVENT`, so a tap is held for the configured window
  (200-1200ms, default 400 — max widened from 800 after real-hardware reports
  of unreliable double-tap; see `constants.ts`'s `DOUBLE_TAP_MAX_MS` comment)
  before being reported as a single tap. A hardware
  double-tap, when it does arrive, cancels the pending single tap.

### Gesture routing (home screen)

**`routeGesture` (`gesture-router.ts`) is the single source of truth.** It is a
pure function from `(AppState, GestureType)` to one target, and
`home-screen.ts`'s `dispatchGesture` only *executes* the target it returns. The
five public handlers (`handleTap`, `handleDoubleTap`, `handleScrollUp`,
`handleScrollDown`, `handleHold`) are one-line adapters. Do not reintroduce a
parallel `if (menu?.isVisible)` ladder in `home-screen.ts` — there used to be
five of them, and keeping them in agreement with `routeGesture` by hand is
exactly the drift this replaced.

Priority order, highest first — banner, Notification_Center, menu, sub-app, HUD:

| State           | tap             | double-tap        | swipe up/down   | hold          |
| --------------- | --------------- | ----------------- | --------------- | ------------- |
| Banner visible  | **expand**      | dismiss + fall through | **dismiss** | (falls through) |
| Expanded view   | dismiss         | dismiss + fall through | dismiss     | (falls through) |
| Center open     | select / confirm| close center      | move selection  | confirm-clear prompt |
| Menu open       | select entry    | close menu        | move highlight  | —             |
| Sub-app active  | forward to app  | close sub-app     | forward to app  | forward to app|
| HUD asleep      | wake            | wake (no menu)    | wake            | wake          |
| HUD awake       | —               | open menu         | down: open center| —            |

Two things `routeGesture` deliberately does not model, both handled in
`dispatchGesture`:

- **Sleep** is not in `AppState`, because sleeping only blanks the HUD columns —
  a menu or center that is up stays readable and keeps its gestures. So only the
  three HUD-level targets (`open-menu`, `open-notification-center`, `none`) are
  gated on it. Opening a surface on a display the wearer cannot see is
  disorienting; the second gesture, against a visible HUD, acts.
- **Double-tap over a banner** has no case in `routeGesture` (it falls through),
  so the banner is dismissed first and routing proceeds as if it were gone —
  preserving the pre-`NotificationSystem` "clear it, then act on what's
  underneath" behavior.

**Tap on a banner expands, it does not dismiss** (SmarterEveryday Requirement
8.1). The two-step lives in `notification-state-machine.ts`, so both taps go to
the same `handleTap()` call — don't "fix" the first tap back to a dismiss.
Swipe is the one-step dismiss. `dismiss()` is still on the interface for
`BannerSystem`-era callers.

`routeGesture` returns only `notification-center-select` for a tap, since
`AppState` has no center *sub*-phase. `dispatchGesture` splits it: in the
`center-confirm-clear` phase a tap confirms the clear-all (the prompt says "Tap
to confirm"), otherwise it selects an entry.

---

## Inactivity timer (formerly "Hidden mode")

`Never Sleep` keeps the HUD lit. `Sleep After` blanks it once the wearer has
gone N seconds without input; any gesture wakes it. `Sleep After`'s duration is
a free number input (`HUD_DURATION_MIN_S`-`HUD_DURATION_MAX_S`, currently
5-600s in `webapp/types.ts`) — it used to be a 5/10/15/30/60s dropdown; that
preset list (`DURATION_OPTIONS`) is gone, not just hidden.

- Stored as `HUD_SLEEP` (`{ mode }`) + `HUD_SLEEP_DELAY`
  (`{ displayDurationSeconds }`).
- The mode value is `"inactivity-timer"`. The legacy value `"hidden"` is still
  accepted on read (`normalizeHudMode`, `readSleepSettings`) so existing installs
  keep their setting — do not drop that migration.
- **The active mode button's highlight is driven by the CSS class `"active"`**
  (`.hud-mode-btn.active` in `index.html`) — `hud-duration-control.ts` used to
  toggle a differently-spelled `"hud-mode-btn--active"` that no stylesheet rule
  targeted, so neither mode ever visibly looked selected, in every environment,
  since the control was first written. If you rename this class, grep for the
  other side of the pair; nothing catches the mismatch at build time.
- **`runtime.ts` does NOT pause the HUD refresh loop or the sleep-inactivity
  timer on `FOREGROUND_EXIT_EVENT`/`FOREGROUND_ENTER_EVENT`.** Those events
  fire when the *phone* backgrounds/locks the Even app
  (`even-realities-docs/build/background-lifecycle.md`), not when the glasses
  go idle — the glasses' own display and BLE link stay up regardless of the
  phone's screen state. An earlier version wired `home.pause()`/`resume()` to
  these events, which froze the sleep timer and HUD refresh every time the
  phone locked (constantly, in real use) and reset the sleep countdown to
  zero on every unlock — the sleep timer could never accumulate enough
  continuous time to fire, which is why this worked in the simulator (a
  browser tab that never fires this event) but not on real hardware. Don't
  re-add that wiring; `HomeScreen` no longer even exposes `pause()`/`resume()`.
- Sleeping only blanks content; components keep refreshing so waking is instant.
- **Removing the `pause()`/`resume()` wiring above was necessary but not
  sufficient.** Real mobile WebViews (Android in particular) suspend or
  heavily throttle `setInterval`/`setTimeout` *on their own*, independent of
  anything this app's code does, while the phone is locked or backgrounded
  — confirmed against the docs and against `reference/community/
  pomodoro-even-g2`, which hits the identical problem. So even with our own
  pause/resume bug gone, the inactivity-sleep `setTimeout`
  (`armSleepTimer`) and the HUD's 60s refresh `setInterval`
  (`hud-manager.ts`) can still silently fire late or not at all — matching
  reports of "Sleep After 15s" never engaging and the HUD (clock, weather,
  the aftermath of a pushed notification) appearing to update only once
  every several minutes instead of continuously. Fixed with
  `home-screen.ts#catchUpAfterPossibleThrottling()`: never trust a
  scheduled callback's cadence, recompute "should this have happened by
  now" from wall-clock-elapsed time, and run that check wherever the JS
  context is *known* to be alive — every raw SDK event
  (`runtime.ts#bridge.onEvenHubEvent`) and explicitly on
  `FOREGROUND_ENTER_EVENT`. Ordering inside that handler matters: the
  catch-up call runs **after** `input.handleEvent`/gesture dispatch, not
  before — a real gesture already calls `noteActivity()` (resets the
  "last activity" clock) via `dispatchGesture`, so checking staleness
  *first* would occasionally sleep the HUD and then immediately wake it
  again one line later for the very gesture that just arrived (caught
  live in the simulator during development, not just reasoned about — a
  double-tap closing the Notification_Center would leave the HUD visibly
  blanked afterward). `FOREGROUND_EXIT/ENTER` still gets its own explicit
  catch-up call in that branch, since it returns early before reaching the
  general one. No equivalent fix exists for the weather *fetch* itself —
  `even-realities-docs/reference/faq.md` confirms network calls genuinely
  cannot happen while the WebView is backgrounded, so a stale weather
  reading only ever re-fetches once the app is foregrounded again, no
  matter what JS-side workaround is used; the catch-up mechanism's job
  there is just to make sure that refetch actually happens immediately
  when foreground resumes; instead of waiting for the next scheduled tick.
- **`catchUpAfterPossibleThrottling`'s `hud.refreshAll()` call is
  wall-clock-gated to at most once per `HUD_REFRESH_INTERVAL_MS`, NOT
  unconditional.** An earlier version called it every single time — every
  raw event, so every scroll and tap — reasoning that `HudSlotRenderer`
  memoizes unchanged *content* so it'd be "free." It isn't: the refresh
  cycle still composes every slot and writes whatever *did* change (the
  clock, typically, since it ticks by the minute), and doing that on every
  gesture measurably increases BLE traffic right at the moment a gesture's
  own bridge calls need to go out. Real-hardware reports of menu selection
  and notification-expand taps intermittently not registering appeared
  after that version shipped — unconfirmed as the root cause, but cheap to
  fix regardless, so it's gated the same way the sleep check already was.
  If you're tempted to make this "more responsive" by calling it more
  often, don't, without confirming BLE bandwidth isn't the constraint on
  real hardware first.
- **The notification banner/expanded view's own auto-dismiss has the
  identical throttling exposure as the sleep timer** — it's also a plain
  `setTimeout` (`notification-system.ts`'s `"start-timer"` effect), so it
  can just as easily never fire while backgrounded, leaving old
  notification text stuck on screen (and, combined with the HUD-blanking
  behavior in the "Container allocation" section above, cutting into
  whatever HUD content was blanked underneath it — since that only gets
  restored when the banner actually clears). Fixed the same way:
  `NotificationSystem.checkTimeoutElapsed()` recomputes from a tracked
  `dismissDueAt` wall-clock timestamp rather than trusting the callback,
  called from the same `catchUpAfterPossibleThrottling()`. Note for tests:
  dismissal archives to `Notification_History` first (an awaited
  `storage.set()`), so `isVisible` doesn't flip synchronously when you call
  `checkTimeoutElapsed()` — same as every other `dispatch()`-driven method
  on this interface, `push()` included; flush a microtask or two before
  asserting, don't `await` a fake timer (there may be none pending to
  advance, by design — that's the scenario being tested).

---

## Testing

`npm test` (vitest, jsdom for every suite — set globally in `vitest.config.ts`,
so do **not** add per-file `@vitest-environment` pragmas).

- `src/storage/storage-manager.test-utils.ts` — shared `createFakeStorage()`.
  Use it rather than hand-rolling another mock; adding a `StorageManager` method
  used to mean editing eight files.
- Property tests use `fast-check` at 100 runs.
- `hud-layout-editor` placement functions take an optional `sizes` map so the
  multi-cell logic stays tested even though production ships every widget 1x1
  (the glasses cannot span columns).

### Simulator loop

```bash
npm run dev        # vite on 5174 + simulator on 9898; quitting either stops both
```

Or split them, which is easier when restarting the simulator repeatedly:

```bash
npm run dev:vite                                        # terminal 1
npx evenhub-simulator http://localhost:5174 --automation-port 9898
```

`npm run dev` used to end in `wait`, which meant closing the simulator window
left vite holding 5174 and the *next* `npm run dev` failed to bind. It now
records vite's PID, `trap`s `EXIT INT TERM` to kill it, and backgrounds the
simulator with `wait $SIM_PID` — waiting on a background job is what makes the
shell interruptible, so the trap runs immediately instead of after the
foreground child returns. Verified: Ctrl-C, `SIGTERM`, and closing the
simulator window all take vite down with them.

`predev` runs `dev:stop` (`lsof -ti tcp:5174 | xargs kill`) first, so a vite
left over from a `SIGKILL`ed or otherwise unclean run is reclaimed rather than
breaking the next launch. `npm run dev:stop` is also the manual escape hatch.

Then drive it over HTTP:

```bash
curl -s http://127.0.0.1:9898/api/screenshot/glasses -o /tmp/g.png
curl -s -X POST http://127.0.0.1:9898/api/input \
  -H 'Content-Type: application/json' -d '{"action":"double_click"}'
curl -s http://127.0.0.1:9898/api/console      # console + uncaught errors
```

Screenshots are RGBA; background pixels have **alpha 0**, lit pixels alpha 255.
Do not convert to RGB — both become pure green and you cannot tell them apart.

**Seeding state for a glasses-only test.** A fresh simulator has no profile and
no HUD layout, so the display is blank and there is nothing to look at. Write a
throwaway `seed.html` at the project root that sets the localStorage keys, point
the simulator at `http://localhost:5174/seed.html`, then relaunch it against
`/`. Same origin, so the values carry over. Delete the file afterwards.

---

## Gotchas that already cost time

- **Shared mutable defaults.** `DEFAULT_WEATHER_CONFIG` was returned by
  reference and then patched with the user's location, permanently mutating the
  module-level constant for every other component and test. Always spread
  defaults (`{ ...DEFAULT_X, ...stored }`), and prefer a factory
  (`emptyRemindersStore()`) when callers mutate the result.
- **The weather cache stores the unit it was fetched in**, which is not
  necessarily the display unit. `renderWeatherContent` converts; it must never
  just relabel, or a unit switch shows the old number with the new suffix.
- **`saveConfig` returns `success: false` when the bridge write fails**, even
  though localStorage holds the value and the event still fires. Surface that to
  the user — reporting success for a value that will not survive a restart is
  how a "saved" setting silently disappears.
- **`"use current location"` writes `lastKnownCoords`, not a place name.** The
  weather component formats it as `"lat,lon"` and `parseCoordinates` short-circuits
  geocoding. Before this the toggle had no effect on what was actually fetched.
  It uses the browser's `navigator.geolocation`; SDK 0.0.11+ has a native
  `getAppLocation()` that would be better (see "Upgrade candidates" below).
- **The `network` whitelist takes full origins only.** `app.json` used to list
  `"https://*"`; wildcards and bare hostnames are rejected outright, so on real
  hardware every weather request would have been blocked while the simulator —
  which does not enforce the whitelist — worked fine. It now lists
  `https://geocoding-api.open-meteo.com` and `https://api.open-meteo.com`.
  Adding a new endpoint means adding its origin here.
- **HUD writes are memoized per container** (`HudSlotRenderer`). A refresh where
  nothing changed costs zero BLE traffic. Call `hud.invalidate()` after anything
  that resets container contents, or the memo will suppress a needed write.
- Widgets that exist in the layout editor but have no HUD component
  (`assistant`, `tasks`) are **dropped** by `hudGridToLayoutConfig`, along with
  out-of-bounds placements. Dropping beats clamping: a widget silently
  relocating to a cell the user did not pick is more confusing than one that
  does not appear.
- **`hud/components/weather.ts`'s `cache` is otherwise write-once-at-init,
  glasses-authored only** — it's set from `getCache()` at component creation
  and thereafter only by the component's own `refresh()` after a real fetch.
  An external write to `STORAGE_KEYS.WEATHER_CACHE` (e.g. the Debug tab's test
  weather push) has *no visible effect* without the `storage.onChange(
  STORAGE_KEYS.WEATHER_CACHE, ...)` subscription the component now has —
  without it, `render()` just keeps returning whatever the component last
  fetched itself. Any other future external writer to that key needs the
  same treatment, not just a `saveConfig`/`applyConfigChange` wire-up.
- **Never call `hud.setVisible(true)` (directly, or via `wakeHud()`) from a
  notification-push call site.** `NotificationSystem`'s `onVisibilityChange`
  already calls `hud.setVisible(false)` synchronously inside `push()` to
  blank the HUD band the banner overlaps — both `setVisible` calls are
  fire-and-forget against the same `HudManager` `visible` flag, so calling
  `wakeHud()` right after `push()` (to "wake the HUD for a notification")
  raced the two: `setVisible(true)` could flip `visible` back and start
  redrawing real HUD content into the columns `setVisible(false)` was still
  in the middle of blanking, while the banner text — a separate container —
  stayed up throughout. Net effect on real hardware: notification text
  rendered directly on top of the clock, stuck, because the HUD content
  "won" the race. Use `noteHudActivityForNotification()` instead (clears
  `hudAsleep` + rearms the sleep timer, no `setVisible` call) — the existing
  `onVisibilityChange(false)` already re-lights the HUD correctly once the
  banner actually goes away, gated on `!hudAsleep`, so there's nothing left
  for a push-time wake to do that racing `setVisible` was ever needed for.
  This shipped for a while unnoticed because it only manifests when
  `hudAsleep` is true *at push time* — `home-screen.test.ts`'s regression
  test for this covers exactly that case, not just "HUD already awake."
- **The phone UI (`index.html`) has two real-device-only WebView quirks,
  neither reproducible in the simulator or a desktop browser tab:** (1) the
  host app's WebView doesn't reliably forward native `body` scroll — fixed by
  making `#phone-ui` itself `overflow-y:auto` with a pinned
  `html,body{height:100%;overflow:hidden}`; (2) focusing any input/select/
  textarea under 16px font-size auto-zooms the viewport (classic mobile
  WebView behavior) and the layout doesn't reliably un-zoom — fixed with a
  blanket `input, select, textarea { font-size: 16px !important; }` rule
  (needs `!important` to beat the many per-control font-size rules,
  including inline `style.cssText` on dynamically-created elements). If a
  phone-side control seems unclickable or the layout looks "floaty
  horizontal" specifically on-device, suspect one of these two before
  anything JS-side — check on a real phone via `npm run qr`, not the
  simulator, which can't reproduce either.
- **Menu/Notification_Center content now starts with a title line** (`"MENU"`,
  `"NOTIFICATIONS"` — `menu-system.ts#buildMenuContent`,
  `notification-system.ts#buildCenterListContent`). Any test or caller that
  splits that content on `"\n"` and indexes into it needs a `+1` offset for
  the title.

---

## Known open items

- **`hold` is classified and routed, but never produced.** `classifyPress`,
  `HOLD_THRESHOLD_MS`, `routeGesture`'s `hold` targets, and the whole path from
  `press-adapter.ts` through `runtime.ts` to `home.handleHold()` are all wired.
  What is missing is hardware: the documented SDK surface exposes no touch-down
  event, so `deriveSignalFromEvent` can only set `pressStartMs === releaseMs`,
  which `classifyPress` always resolves as `"released"`. The adapter never emits
  `"hold"`, so clear-all-history cannot be triggered on device even though every
  line of code above it works. Fixing this means a real press-start signal, not
  a change to any of the above. `handleHold()` is directly callable in tests,
  which is how the center's confirm-clear path is covered.
- **SmarterEveryday can never actually deliver content.**
  `createPlaceholderLlmClient` always rejects — no code in this codebase calls
  an LLM provider (Assistant_App's config form only *selects* one and collects
  no API key). The Scheduler ticks, `ContentGenerator.deliver` resolves
  `"failed"`, and nothing reaches the notification system. Everything downstream
  of the LLM call is wired and tested; the provider call itself does not exist.
- **Auto-pause after 3 failures is pure but unwired** (Requirement 5).
  `nextFailureCount` and `shouldPause` exist in `content-generator.ts` and have
  no callers, so `Topic.consecutiveFailures` is never incremented and a
  permanently-failing topic retries forever instead of pausing.
- **QA blocker: double-tap does not exit.** Confirmed against
  `../even-realities-docs/ship/app-submission.md` (2026-07-10): "Root-page
  double-tap calls `bridge.shutDownPageContainer(1)`. Mode 0 and custom in-app
  exit UIs on the root page are both rejected." Foresight uses double-tap to
  open the menu and offers exit *as a menu entry* — which is precisely the
  custom-exit-UI pattern named as a rejection. This is not a "may"; it will
  fail review as built. Resolving it means either giving up double-tap-for-menu
  on the root page, or accepting that Foresight is sideload-only.
- **Auth is a local stand-in.** `authenticate()` in `webapp/phone-ui.ts` accepts
  any credentials and verifies nothing. Swapping in a real provider should only
  require changing that function.
- The marketplace view is wired with an empty app list.

## Upgrade candidates (SDK 0.0.11 / 0.0.12)

Foresight is pinned to `^0.0.10`; these are available if it moves to 0.0.12.
None are required — listed so the next session doesn't have to rediscover them.

- **`getAppLocation()` / `startAppLocationUpdates()`** replaces the
  `navigator.geolocation` call in `webapp/weather-config-form.ts` with a native
  path (accuracy tiers, `distanceFilter`, background-aware). Needs the
  `location` permission in `app.json`.
- **`zOrderIndex`** — see the container section above.
- **Automatic LZ4 image compression**, and `compressMode` is gone. Irrelevant
  today (Foresight renders no images) but relevant if a widget ever does.
- **`AudioInputSource.Phone`** lets `audioControl()` capture from the phone mic
  instead of the glasses array — relevant to the unbuilt Assistant feature.

Bumping the SDK also means bumping `min_sdk_version` in `app.json`, which is a
one-way trip: it strands users on older firmware. Don't bump it preemptively.
