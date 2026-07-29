/**
 * Shared in-memory StorageManager double.
 *
 * Test-only; nothing in the production graph imports it. Kept in one place so
 * that adding a method to `StorageManager` does not mean editing the same
 * hand-rolled mock in eight test files.
 */

import type { StorageManager } from "./storage-manager";

export interface FakeStorage extends StorageManager {
  /** Seed a value without going through the (async) write path. */
  seed<T>(key: string, value: T): void;
  /** Everything currently held, for assertions. */
  readonly entries: Map<string, unknown>;
}

export function createFakeStorage(
  initial: Record<string, unknown> = {},
): FakeStorage {
  const store = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  function notify(key: string, value: unknown): void {
    const keyListeners = listeners.get(key);
    if (!keyListeners) return;
    for (const callback of [...keyListeners]) callback(value);
  }

  function seed<T>(key: string, value: T): void {
    // Round-trip through JSON so tests see the same structural-copy semantics
    // the real StorageManager gives (no shared object identity with callers).
    store.set(key, JSON.parse(JSON.stringify(value)));
  }

  return {
    entries: store,
    seed,

    get<T>(key: string): T | null {
      const value = store.get(key);
      if (value === undefined || value === null) return null;
      return JSON.parse(JSON.stringify(value)) as T;
    },

    async set<T>(key: string, value: T): Promise<void> {
      seed(key, value);
      notify(key, value);
    },

    setCached<T>(key: string, value: T): void {
      seed(key, value);
      notify(key, value);
    },

    async remove(key: string): Promise<void> {
      store.delete(key);
      notify(key, null);
    },

    onChange(key: string, callback: (value: unknown) => void): () => void {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(callback);
      return () => {
        set!.delete(callback);
        if (set!.size === 0) listeners.delete(key);
      };
    },

    async loadKey(): Promise<void> {},
    async loadKeys(): Promise<void> {},
  };
}
