/**
 * Foresight - Web Configuration UI Entry Point (config.html)
 *
 * Responsibilities:
 * - Attempt to connect to the SDK bridge
 * - Initialize StorageManager with the bridge
 * - Load existing HUD layout config from storage
 * - Mount the grid editor into the DOM
 * - Show connection error if bridge is unavailable (Req 9.8)
 * - Populate config within 3 seconds of load (Req 9.7)
 */

import {
  createStorageManager,
  type StorageManager,
} from "../storage/storage-manager";
import { GridEditor } from "./grid-editor";

export interface ConfigUIOptions {
  /** The SDK bridge instance, or null if unavailable */
  bridge: any | null;
  /** The root container element for the config UI */
  rootElement: HTMLElement;
}

export interface ConfigUIController {
  readonly gridEditor: GridEditor;
  readonly storage: StorageManager | null;
  readonly connected: boolean;
}

/**
 * Initialize the Web Config UI.
 * Must populate all config within 3 seconds of load (Req 9.7).
 */
export async function initConfigUI(
  options: ConfigUIOptions,
): Promise<ConfigUIController> {
  const { bridge, rootElement } = options;

  let storage: StorageManager | null = null;
  let connected = false;

  // Create grid editor container
  const gridContainer = document.createElement("div");
  gridContainer.id = "hud-grid-editor";
  rootElement.appendChild(gridContainer);

  // Error message container
  const errorContainer = document.createElement("div");
  errorContainer.id = "connection-error";
  errorContainer.className = "error-message";
  errorContainer.style.display = "none";
  rootElement.appendChild(errorContainer);

  const gridEditor = new GridEditor();

  if (bridge) {
    try {
      storage = createStorageManager(bridge);
      connected = true;

      // Load persisted keys into cache before reading them
      await storage.loadKeys([
        "foresight-hud-layout-v1",
        "foresight-clock-config-v1",
        "foresight-weather-config-v1",
        "foresight-reminders-v1",
        "foresight-banner-config-v1",
      ]);

      // Initialize grid editor with storage and load persisted config
      gridEditor.init(gridContainer, storage);
      gridEditor.loadConfig();
    } catch {
      // Bridge provided but failed to initialize
      connected = false;
      showConnectionError(errorContainer);
      gridEditor.init(gridContainer, createFallbackStorage());
    }
  } else {
    // Bridge unavailable — show connection error, retain unsaved input (Req 9.8)
    showConnectionError(errorContainer);
    gridEditor.init(gridContainer, createFallbackStorage());
  }

  return {
    gridEditor,
    storage,
    connected,
  };
}

/**
 * Display a connection error message to the user.
 */
function showConnectionError(container: HTMLElement): void {
  container.style.display = "block";
  container.textContent =
    "Connection unavailable. Changes cannot be synced to glasses. Your input will be retained.";
}

/**
 * Creates a no-op in-memory storage for when bridge is unavailable.
 * Allows the user to still interact with the UI and retain unsaved input.
 */
function createFallbackStorage(): StorageManager {
  const store = new Map<string, unknown>();

  return {
    get<T>(key: string): T | null {
      const value = store.get(key);
      return value !== undefined ? (value as T) : null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async remove(key: string): Promise<void> {
      store.delete(key);
    },
    onChange(_key: string, _callback: (value: unknown) => void): () => void {
      return () => {};
    },
    async loadKey(_key: string): Promise<void> {},
    async loadKeys(_keys: string[]): Promise<void> {},
  };
}
