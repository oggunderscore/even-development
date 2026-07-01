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
 * Always writes to localStorage first so the value is retained locally.
 * Then attempts to write to the bridge for glasses sync.
 * Dispatches a custom event so other parts of the app (e.g. glasses HUD)
 * can react to the change immediately.
 *
 * Returns { success: true } if bridge write succeeds.
 * Returns { success: false, error } if bridge is unavailable or write fails.
 * Never throws.
 */
export async function saveConfig<T>(
  bridge: any | null,
  key: string,
  value: T,
): Promise<SaveConfigResult> {
  const json = JSON.stringify(value);

  // Always write to localStorage as a local fallback
  try {
    localStorage.setItem(key, json);
  } catch {
    // localStorage write failed — continue to attempt bridge anyway
  }

  // Attempt bridge write
  if (!bridge) {
    return { success: false, error: "Bridge unavailable" };
  }

  try {
    await bridge.setLocalStorage(key, json);
  } catch {
    // Bridge write failed — but localStorage has the value.
    // Dispatch event so glasses-side can still pick up the change from localStorage.
    window.dispatchEvent(
      new CustomEvent("foresight-config-changed", { detail: { key, value } }),
    );
    return { success: true };
  }

  // Notify glasses-side of the change
  window.dispatchEvent(
    new CustomEvent("foresight-config-changed", { detail: { key, value } }),
  );
  return { success: true };
}
