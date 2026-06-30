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

  async function set<T>(key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    cache.set(key, json);
    await bridge.setLocalStorage(key, json);

    // Notify listeners for this key
    const keyListeners = listeners.get(key);
    if (keyListeners) {
      for (const callback of keyListeners) {
        callback(value);
      }
    }
  }

  async function remove(key: string): Promise<void> {
    cache.set(key, null);
    await bridge.setLocalStorage(key, "");

    // Notify listeners that the key was removed
    const keyListeners = listeners.get(key);
    if (keyListeners) {
      for (const callback of keyListeners) {
        callback(null);
      }
    }
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

  async function loadKey(key: string): Promise<void> {
    try {
      const raw = await bridge.getLocalStorage(key);
      cache.set(key, raw || null);
    } catch {
      cache.set(key, null);
    }
  }

  async function loadKeys(keys: string[]): Promise<void> {
    await Promise.all(keys.map(loadKey));
  }

  return { get, set, remove, onChange, loadKey, loadKeys };
}
