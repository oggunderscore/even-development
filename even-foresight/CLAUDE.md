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
                  src/glasses/*, src/hud/*, src/menu/*, src/banner/*
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

Defined once in `src/constants.ts` (`CONTAINER`, `CONTAINER_NAME`). Never
hard-code a container ID anywhere else.

> **Never call `rebuildPageContainer` outside `home-screen.ts`.**
>
> A rebuild replaces the *entire page* and destroys every container. The menu
> used to rebuild the page to show itself, which silently deleted HUD columns
> 1-4 — so the HUD went permanently blank the first time you opened the menu,
> and every later `textContainerUpgrade` to those IDs no-oped. If you need a
> new surface, add a container to `buildPageContainers()` instead. G2 allows 8
> non-image containers per page; 7 are used.

Other container facts learned the hard way:

- **Exactly one** container may set `isEventCapture: 1`. It is the menu, because
  that is the only surface long enough to need firmware overflow scrolling.
  Input events are delivered to the app regardless of which container holds it.
- `containerName` is capped at **16 characters** and must be unique per page.
- Overlap compositing is unspecified. The banner overlaps the HUD band, so
  rather than trusting it, showing a banner explicitly blanks the HUD
  (`onVisibilityChange` → `hud.setVisible(false)`) and restores it after.

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
├── banner/banner-system.ts  notification queue (writes container 6)
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
  (200-800ms, default 400) before being reported as a single tap. A hardware
  double-tap, when it does arrive, cancels the pending single tap.

### Gesture routing (home screen)

| State          | tap             | double-tap        | swipe up/down |
| -------------- | --------------- | ----------------- | ------------- |
| Banner visible | dismiss banner  | dismiss banner    | —             |
| Menu open      | select entry    | close menu        | move highlight|
| HUD asleep     | wake            | wake (no menu)    | wake          |
| HUD awake      | —               | open menu         | —             |

A double-tap on a *sleeping* HUD only wakes it. Opening a menu on a display the
wearer cannot see is disorienting; the second double-tap opens it.

---

## Inactivity timer (formerly "Hidden mode")

`Never Sleep` keeps the HUD lit. `Sleep After` blanks it once the wearer has
gone N seconds without input; any gesture wakes it. Options: 5/10/15/30/60s.

- Stored as `HUD_SLEEP` (`{ mode }`) + `HUD_SLEEP_DELAY`
  (`{ displayDurationSeconds }`).
- The mode value is `"inactivity-timer"`. The legacy value `"hidden"` is still
  accepted on read (`normalizeHudMode`, `readSleepSettings`) so existing installs
  keep their setting — do not drop that migration.
- Sleeping only blanks content; components keep refreshing so waking is instant.

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
npm run dev:vite                                        # terminal 1
npx evenhub-simulator http://localhost:5174 --automation-port 9898
```

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
- **HUD writes are memoized per container** (`HudSlotRenderer`). A refresh where
  nothing changed costs zero BLE traffic. Call `hud.invalidate()` after anything
  that resets container contents, or the memo will suppress a needed write.
- Widgets that exist in the layout editor but have no HUD component
  (`assistant`, `tasks`) are **dropped** by `hudGridToLayoutConfig`, along with
  out-of-bounds placements. Dropping beats clamping: a widget silently
  relocating to a cell the user did not pick is more confusing than one that
  does not appear.

---

## Known open items

- **QA risk: double-tap does not exit.** Platform review expects double-tap on
  the root page to call `shutDownPageContainer(1)`. Foresight uses double-tap
  for the menu, and offers exit as a menu entry instead. This is a deliberate
  product decision but may draw a review rejection — see
  `../even-realities-docs/build/page-lifecycle.md`.
- **Auth is a local stand-in.** `authenticate()` in `webapp/phone-ui.ts` accepts
  any credentials and verifies nothing. Swapping in a real provider should only
  require changing that function.
- `app.json` declares `min_app_version: "1.0.0"`; the current platform edition
  is `2.0.0`. Revisit before submission.
- The marketplace view is wired with an empty app list.
