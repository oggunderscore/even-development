# SubApp Guide

This guide documents the `SubApp_SDK` — the interface contract every Foresight sub-app (built-in or third-party) implements — so you can build and register your own sub-app without needing help from the Foresight maintainers.

`SmarterEveryday` (`src/smarter-everyday/smarter-everyday-app.ts`) is the reference implementation. Where this guide shows a snippet, it either quotes real source directly or is a minimal variant of it.

## 1. The `SubApp` interface

Defined in `src/sub-app/types.ts`:

```typescript
export interface GestureEvent {
  type: GestureType;
  timestamp: number;
}

/** The interface every sub-app (built-in or third-party) implements. */
export interface SubApp {
  readonly id: string;
  readonly name: string;
  activate(context: SubAppContext): Promise<void>;
  handleGesture(event: GestureEvent): void;
  cleanup(): Promise<void>;
}
```

| Field                  | Type                                        | Purpose                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | `string`                                    | Stable, unique identifier for your sub-app (e.g. `"smarter-everyday"`). Used as its registry/menu key.                                                                                                                                                                                                                         |
| `name`                 | `string`                                    | Human-readable display name shown in the app menu.                                                                                                                                                                                                                                                                             |
| `activate(context)`    | `(context: SubAppContext) => Promise<void>` | Called when the user opens your sub-app from the menu. Receives a `SubAppContext` for rendering — request containers and draw your initial view here.                                                                                                                                                                          |
| `handleGesture(event)` | `(event: GestureEvent) => void`             | Called for every gesture forwarded to your sub-app while it's active (see [§4](#4-gesture-forwarding)). Not async — kick off any async work internally (e.g. `void render()`) rather than returning a promise.                                                                                                                 |
| `cleanup()`            | `() => Promise<void>`                       | Called when your sub-app is deactivated (the user double-taps out, or another sub-app activates). Clear any containers you wrote to and drop your in-memory state. Must resolve within ~1 second — the container that owns your lifecycle races `cleanup()` against a timeout and force-releases if it doesn't return in time. |

A `SubApp` is created by a plain factory function, not a class:

```typescript
export function createMySubApp(/* your deps */): SubApp {
  return {
    id: "my-sub-app",
    name: "My Sub-App",
    async activate(context) {
      /* ... */
    },
    handleGesture(event) {
      /* ... */
    },
    async cleanup() {
      /* ... */
    },
  };
}
```

## 2. Registration and the 10-sub-app maximum

Sub-apps are surfaced to the user through the same app-menu mechanism every built-in app uses — there is no separate "sub-app installer" flow. Registering a sub-app means adding a `MenuEntry` (from `src/menu/types.ts`) that delegates to your `SubApp` through the shared `SubAppContainer`:

```typescript
export interface MenuEntry {
  id: string;
  name: string;
  activate: () => Promise<void>;
  cleanup: () => Promise<void>;
}
```

The wiring pattern, following how `main.ts` composes built-in apps:

```typescript
import { createSubAppContainer } from "./sub-app/sub-app-container";
import { createMySubApp } from "./my-sub-app/my-sub-app";

const subAppContainer = createSubAppContainer(bridge);
const mySubApp = createMySubApp(/* deps */);

const menuEntries: MenuEntry[] = [
  // ...other entries...
  {
    id: mySubApp.id,
    name: mySubApp.name,
    activate: () => subAppContainer.activate(mySubApp),
    cleanup: () => subAppContainer.deactivate(),
  },
];

const menuSystem = createMenuSystem(bridge, menuEntries);
```

`createMenuSystem` enforces a hard cap of **10 registered entries** via `MENU_MAX_ENTRIES` (`src/constants.ts`) — entries beyond the 10th are silently dropped:

```typescript
// src/menu/menu-system.ts
const menuEntries = entries.slice(0, MENU_MAX_ENTRIES); // MENU_MAX_ENTRIES = 10
```

`SubAppContainer` (`src/sub-app/sub-app-container.ts`) itself only ever holds **one active sub-app at a time**: activating a new one automatically deactivates (and `cleanup()`s) whichever sub-app was previously active, so you never need to guard against re-entrancy in your own `activate`/`cleanup`.

A persisted `SubAppRegistry` schema also exists in `src/storage/schemas.ts` (`SubAppRegistryEntry { id, name, order }`) for apps that want their registration order/metadata to survive reloads — this is a plain storage record, not a code API; write to it via `StorageManager` the same way you would any other setting (see [§5](#5-persisting-sub-app-settings-the-bridgestoragemanager-pattern)).

## 3. `SubAppContext`: containers and content updates

`activate()` receives a `SubAppContext` (`src/sub-app/types.ts`):

```typescript
export interface SubAppContext {
  readonly width: 576;
  readonly height: 173;
  readonly yOffset: 115;
  updateContent(containerIndex: number, content: string): Promise<void>;
  requestContainers(count: number): number[];
}
```

- `width` / `height` / `yOffset` describe the fixed rendering surface your sub-app owns on the 576×288 glasses display (a 576×173 region, offset 115px from the top) — the same region for every sub-app, so you don't need to compute layout yourself.
- `requestContainers(count)` allocates `count` container IDs for your sub-app to draw into. Call this once, in `activate()`, and hold onto the returned IDs for the lifetime of your activation.
- `updateContent(containerIndex, content)` writes text into one of your allocated containers. Call it again any time your content changes (e.g. in response to a gesture) — it does not re-allocate or rebuild the container.

Minimal usage:

```typescript
async activate(context: SubAppContext): Promise<void> {
  const [containerId] = context.requestContainers(1);
  await context.updateContent(containerId, "Hello, world!");
}
```

Most sub-apps only need a single container and render multi-line content as one newline-joined string (the same approach `menu-system.ts` and `smarter-everyday-app.ts` use), rather than requesting one container per line.

To clear your view on deactivation, write an empty string to each container you requested:

```typescript
async cleanup(): Promise<void> {
  for (const id of containerIds) {
    await context.updateContent(id, "");
  }
}
```

## 4. Gesture forwarding

`Gesture_Router` classifies raw touchpad input into one of five `GestureType` values (`src/gesture-router.ts`):

```typescript
export type GestureType =
  | "single-tap"
  | "double-tap"
  | "swipe-up"
  | "swipe-down"
  | "hold";
```

| Gesture      | Typical use                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single-tap` | Select / confirm                                                                                                                                    |
| `double-tap` | Back / exit — **not forwarded to your sub-app** (see below)                                                                                         |
| `swipe-up`   | Scroll up / navigate previous                                                                                                                       |
| `swipe-down` | Scroll down / navigate next                                                                                                                         |
| `hold`       | A sustained press (≥600ms) — distinct from tap/double-tap, useful for a "confirm" or destructive action that shouldn't trigger on an accidental tap |

While your sub-app is active, `SubAppContainer.handleGesture` (`src/sub-app/sub-app-container.ts`) forwards every gesture to your `handleGesture(event)` **except `double-tap`**, which the container intercepts to deactivate your sub-app (calling your `cleanup()`) instead:

```typescript
function handleGesture(event: GestureEvent): void {
  if (activeApp === null) return;

  // Intercept double-tap — do NOT forward to sub-app
  if (event.type === "double-tap") return;

  // Forward single-tap, swipe-up, swipe-down, and hold to the active sub-app
  activeApp.handleGesture(event);
}
```

So a `SubApp`'s `handleGesture` only ever sees `"single-tap"`, `"swipe-up"`, `"swipe-down"`, and `"hold"`. If your sub-app doesn't use a particular gesture, simply ignore it:

```typescript
handleGesture(event: GestureEvent): void {
  if (event.type === "swipe-up") { /* scroll up */ return; }
  if (event.type === "swipe-down") { /* scroll down */ return; }
  // "single-tap" and "hold" ignored by this sub-app
}
```

## 5. Persisting sub-app settings: the Bridge/`StorageManager` pattern

If your sub-app needs configuration that survives across sessions (topics, preferences, anything the user edits from the phone webapp), persist it through `StorageManager` (`src/storage/storage-manager.ts`), which wraps the Even SDK's `Bridge` localStorage (`bridge.setLocalStorage`/`getLocalStorage`):

```typescript
export interface StorageManager {
  get<T>(key: string): T | null; // synchronous, cache-only read
  set<T>(key: string, value: T): Promise<void>; // writes cache + bridge + localStorage
  remove(key: string): Promise<void>;
  onChange(key: string, callback: (value: unknown) => void): () => void;
  loadKey(key: string): Promise<void>;
  loadKeys(keys: string[]): Promise<void>;
}
```

Because bridge reads are asynchronous but `get()` must be synchronous (gesture handling can't block on I/O), `StorageManager` keeps an in-memory cache: `set()` writes through to the cache immediately, and `get()` only ever reads that cache. You must `loadKey`/`loadKeys` once at startup to hydrate the cache before your sub-app's first synchronous `get()` call.

`src/smarter-everyday/topic-manager.ts` is the worked example of this pattern end-to-end — a `TopicManager` built as a thin `StorageManager`-backed factory over pure reducer functions:

```typescript
// Reserve a dedicated storage key, added to STORAGE_KEYS in src/storage/schemas.ts:
SMARTER_EVERYDAY_TOPICS: "foresight-smarter-everyday-topics-v1",

export function createTopicManager(storage: StorageManager): TopicManager {
  function readTopics(): Topic[] {
    return (
      storage.get<SmarterEverydayTopicsStore>(STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS)
        ?? DEFAULT_SMARTER_EVERYDAY_TOPICS
    ).topics;
  }

  async function writeTopics(topics: Topic[]): Promise<void> {
    await storage.set<SmarterEverydayTopicsStore>(
      STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      { topics },
    );
  }

  return {
    list(): Topic[] {
      return readTopics();
    },
    async update(id: string, edit: TopicEdit): Promise<void> {
      const topics = readTopics();
      const newTopics = editTopic(topics, id, edit); // pure reducer
      await writeTopics(newTopics);
    },
    // ...create/remove follow the same read -> pure-reduce -> write shape
  };
}
```

The pattern to copy for your own sub-app's settings:

1. Add a `STORAGE_KEYS` entry in `src/storage/schemas.ts` (versioned, e.g. `"foresight-my-sub-app-settings-v1"`), plus a data interface and a `DEFAULT_*` fallback constant.
2. Add that key to the glasses runtime's hydration list (`HYDRATED_KEYS` in `src/glasses/runtime.ts`) so `get()` has data by the time your sub-app activates.
3. Write pure functions for any validation/update logic (e.g. `editTopic`), independent of `StorageManager` — this is what makes them unit/property-testable without mocking storage.
4. Wrap those pure functions in a small factory (`createXManager(storage)`) that does `read (storage.get, falling back to DEFAULT_*) -> pure transform -> write (storage.set)`.
5. On the phone webapp side, save changes through `storage-helpers.ts`'s `saveConfig`, which already implements "retain input and show an error on failure, no message on success" — see `weather-config-form.ts` or `assistant-config-form.ts` for the config-form half of this pattern.

## 6. Minimal working example: a "Hello World" sub-app

This is a complete, runnable sub-app: it renders a static greeting on activation, ignores gestures, and clears its container on cleanup.

```typescript
// src/hello-world/hello-world-app.ts
import type { GestureEvent, SubApp, SubAppContext } from "../sub-app/types";

export function createHelloWorldApp(): SubApp {
  let context: SubAppContext | null = null;
  let containerId: number | null = null;

  return {
    id: "hello-world",
    name: "Hello World",

    async activate(ctx: SubAppContext): Promise<void> {
      context = ctx;
      [containerId] = ctx.requestContainers(1);
      await ctx.updateContent(containerId, "Hello, world!");
    },

    handleGesture(event: GestureEvent): void {
      if (context === null || containerId === null) return;

      if (event.type === "single-tap") {
        void context.updateContent(containerId, "You tapped me!");
      }
      // swipe-up, swipe-down, and hold are ignored by this example
    },

    async cleanup(): Promise<void> {
      if (context !== null && containerId !== null) {
        await context.updateContent(containerId, "");
      }
      context = null;
      containerId = null;
    },
  };
}
```

Registering it (see [§2](#2-registration-and-the-10-sub-app-maximum)):

```typescript
const helloWorldApp = createHelloWorldApp();
const menuEntries: MenuEntry[] = [
  // ...other entries...
  {
    id: helloWorldApp.id,
    name: helloWorldApp.name,
    activate: () => subAppContainer.activate(helloWorldApp),
    cleanup: () => subAppContainer.deactivate(),
  },
];
```

For a more complete reference implementation — one that also schedules background work independent of activation, persists per-user configuration, and integrates with the notification system — see `src/smarter-everyday/smarter-everyday-app.ts` and its supporting modules (`topic-manager.ts`, `scheduler.ts`, `content-generator.ts`).
