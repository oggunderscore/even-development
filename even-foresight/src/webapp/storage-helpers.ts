/**
 * Lightweight storage helpers for the webapp views.
 *
 * These provide typed read/write operations that attempt the SDK bridge first,
 * fall back to browser localStorage, and never throw — all errors are caught
 * and returned gracefully as result objects.
 */

/**
 * Load a config value from the bridge (preferred) or localStorage (fallback).
 *
 * Resolution order:
 * 1. If bridge is available, try bridge.getLocalStorage(key) → parse JSON
 * 2. If bridge is null or bridge call throws, try localStorage.getItem(key) → parse JSON
 * 3. If both fail or return nothing parseable, return defaultValue
 */
export async function loadConfig<T>(
  bridge: any | null,
  key: string,
  defaultValue: T,
): Promise<T> {
  // Attempt bridge first
  if (bridge) {
    try {
      const raw = await bridge.getLocalStorage(key);
      if (raw) {
        return JSON.parse(raw) as T;
      }
    } catch {
      // Bridge failed — fall through to localStorage
    }
  }

  // Fallback to browser localStorage
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // localStorage unavailable or parse failed
  }

  return defaultValue;
}

export interface SaveConfigResult {
  success: boolean;
  error?: string;
}

/**
 * Save a config value to both localStorage (local fallback) and the bridge.
 *
 * Writes localStorage first so the value survives a failed bridge call, then
 * attempts the bridge write that persists it for the glasses. Either way it
 * dispatches `foresight-config-changed`, which is how the glasses runtime
 * — living in the same document — learns about the change without polling.
 *
 * Returns `{ success: true }` only when the value actually reached the
 * bridge. A failed bridge write reports `success: false`: the value is still
 * held locally and the running session stays in sync via the event, but it
 * will not survive a restart, and callers surface that to the user rather
 * than showing a "Saved" that is not true.
 *
 * Never throws.
 */
export async function saveConfig<T>(
  bridge: any | null,
  key: string,
  value: T,
): Promise<SaveConfigResult> {
  const json = JSON.stringify(value);

  try {
    localStorage.setItem(key, json);
  } catch {
    // Quota or private mode — the bridge write below may still succeed.
  }

  let result: SaveConfigResult = { success: true };

  if (!bridge) {
    result = { success: false, error: "Bridge unavailable" };
  } else {
    try {
      await bridge.setLocalStorage(key, json);
    } catch {
      result = { success: false, error: "Bridge unavailable" };
    }
  }

  // Dispatched even on failure: localStorage holds the value, so the glasses
  // side should reflect it for this session.
  window.dispatchEvent(
    new CustomEvent("foresight-config-changed", { detail: { key, value } }),
  );

  return result;
}
