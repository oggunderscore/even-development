/**
 * StorageManager wraps the Foresight SDK's localStorage bridge,
 * providing typed get/set/remove operations with JSON serialization
 * and a change notification system.
 *
 * Since the SDK's getLocalStorage is async, we maintain an in-memory
 * cache that's hydrated via loadKey() or preloaded during init.
 * The synchronous get() reads from cache only, which is populated
 * by awaiting set() or calling loadKey() explicitly.
 */

export interface StorageManager {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): Promise<void>;
  /**
   * Update the read cache without writing back to the bridge.
   *
   * For values the phone webapp already persisted: it wrote through the
   * bridge itself, so a `set()` here would be a redundant round trip that can
   * also race the webapp's own write. Notifies `onChange` listeners as usual.
   */
  setCached<T>(key: string, value: T): void;
  remove(key: string): Promise<void>;
  onChange(key: string, callback: (value: unknown) => void): () => void;
  /** Load a key from bridge storage into the local cache */
  loadKey(key: string): Promise<void>;
  /** Load multiple keys from bridge storage into the local cache */
  loadKeys(keys: string[]): Promise<void>;
}

type ChangeListener = (value: unknown) => void;

/**
 * Creates a StorageManager backed by the SDK's localStorage bridge.
 *
 * The bridge exposes:
 * - bridge.setLocalStorage(key: string, value: string): Promise<boolean>
 * - bridge.getLocalStorage(key: string): Promise<string>
 *
 * All values are stored as JSON strings. On corrupt/unparseable data,
 * get() returns null and callers fall back to their own defaults.
 *
 * Because getLocalStorage is async, we use a write-through cache:
 * - set() writes to both cache and bridge
 * - get() reads from cache only (fast, synchronous)
 * - loadKey()/loadKeys() hydrates cache from bridge (call at startup)
 */
export function createStorageManager(bridge: any): StorageManager {
  const listeners = new Map<string, Set<ChangeListener>>();
  const cache = new Map<string, string | null>();

  function get<T>(key: string): T | null {
    try {
      const raw = cache.get(key);
      if (raw === null || raw === undefined) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt or unparseable data — fall back to null
      return null;
    }
  }

  function notify(key: string, value: unknown): void {
    const keyListeners = listeners.get(key);
    if (!keyListeners) return;
    // Copy first: a listener may unsubscribe itself while we iterate.
    for (const callback of [...keyListeners]) {
      callback(value);
    }
  }

  function writeLocal(key: string, value: string): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
    } catch {
      // Quota or private mode — the bridge copy is the one that matters.
    }
  }

  function setCached<T>(key: string, value: T): void {
    cache.set(key, JSON.stringify(value));
    notify(key, value);
  }

  async function set<T>(key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    cache.set(key, json);
    // Mirror to localStorage the same way the webapp does, so both halves of
    // the app agree no matter which one wrote last.
    writeLocal(key, json);
    try {
      await bridge.setLocalStorage(key, json);
    } catch {
      // The bridge can reject while the phone app is backgrounded. The cache
      // already holds the value, so the session stays consistent; the write
      // will be retried the next time this key is saved.
    }
    notify(key, value);
  }

  async function remove(key: string): Promise<void> {
    cache.set(key, null);
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      await bridge.setLocalStorage(key, "");
    } catch {
      // See set() — cache stays authoritative for this session.
    }
    notify(key, null);
  }

  function onChange(key: string, callback: ChangeListener): () => void {
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    const keyListeners = listeners.get(key)!;
    keyListeners.add(callback);

    // Return unsubscribe function
    return () => {
      keyListeners.delete(callback);
      if (keyListeners.size === 0) {
        listeners.delete(key);
      }
    };
  }

  /**
   * Reads browser localStorage, which the phone webapp writes to alongside
   * every bridge write (see `webapp/storage-helpers.ts`).
   */
  function readLocal(key: string): string | null {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(key)
        : null;
    } catch {
      return null;
    }
  }

  async function loadKey(key: string): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await bridge.getLocalStorage(key);
    } catch {
      // Bridge read failed — the localStorage mirror below still applies.
    }

    // Fall back to the browser copy when the bridge has nothing. The two
    // stores are written together but only localStorage survives a simulator
    // reload, so without this the glasses come back up with no config while
    // the phone UI still shows it — which looks like the settings were lost.
    if (!raw) {
      raw = readLocal(key);
      if (raw) {
        // Re-seed the bridge so the next read is served from the real store.
        void Promise.resolve(bridge.setLocalStorage(key, raw)).catch(() => {});
      }
    }

    cache.set(key, raw || null);
  }

  async function loadKeys(keys: string[]): Promise<void> {
    await Promise.all(keys.map(loadKey));
  }

  return { get, set, setCached, remove, onChange, loadKey, loadKeys };
}
