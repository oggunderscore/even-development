import type { StorageManager } from "../storage/storage-manager";
import type { HudComponentType } from "../hud/types";
import type { HudLayoutConfig } from "../storage/schemas";
import { STORAGE_KEYS, DEFAULT_HUD_LAYOUT } from "../storage/schemas";
import { HUD_ROWS, HUD_COLS } from "../constants";

/**
 * GridEditor manages the 2×5 HUD slot grid in the Web Config UI.
 * It provides methods to load, display, modify, and persist slot assignments.
 */
export class GridEditor {
  private config: HudLayoutConfig;
  private container: HTMLElement | null = null;
  private storage: StorageManager | null = null;

  constructor() {
    this.config = structuredClone(DEFAULT_HUD_LAYOUT);
  }

  /**
   * Mount the grid editor into a DOM container and bind to storage.
   */
  init(container: HTMLElement, storage: StorageManager): void {
    this.container = container;
    this.storage = storage;
    this.render();
  }

  /**
   * Load HUD layout config from storage and re-render the grid.
   */
  loadConfig(): void {
    if (!this.storage) return;

    const stored = this.storage.get<HudLayoutConfig>(STORAGE_KEYS.HUD_LAYOUT);
    if (stored && Array.isArray(stored.slots)) {
      this.config = stored;
    } else {
      this.config = structuredClone(DEFAULT_HUD_LAYOUT);
    }
    this.render();
  }

  /**
   * Assign or clear a component in a specific slot.
   * Same component type can be assigned to multiple slots (Req 9.9).
   */
  setSlot(
    row: 0 | 1,
    col: 0 | 1 | 2 | 3 | 4,
    componentType: HudComponentType | null,
  ): void {
    const slot = this.config.slots.find((s) => s.row === row && s.col === col);
    if (slot) {
      slot.componentType = componentType;
    }
    this.render();
  }

  /**
   * Returns the current grid configuration state.
   */
  getConfig(): HudLayoutConfig {
    return structuredClone(this.config);
  }

  /**
   * Persist the current grid config to storage via bridge.
   * Must complete within 2 seconds (Req 9.2).
   */
  async save(): Promise<void> {
    if (!this.storage) {
      throw new Error("Storage not initialized");
    }
    await this.storage.set(STORAGE_KEYS.HUD_LAYOUT, this.config);
  }

  /**
   * Render the grid into the container DOM element.
   */
  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "hud-grid";
    grid.setAttribute("role", "grid");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${HUD_COLS}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${HUD_ROWS}, 1fr)`;
    grid.style.gap = "4px";

    for (let row = 0; row < HUD_ROWS; row++) {
      for (let col = 0; col < HUD_COLS; col++) {
        const slot = this.config.slots.find(
          (s) => s.row === row && s.col === col,
        );
        const componentType = slot?.componentType ?? null;

        const cell = document.createElement("div");
        cell.className = "hud-slot";
        cell.setAttribute("role", "gridcell");
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.textContent = componentType
          ? this.formatComponentName(componentType)
          : "Empty";

        grid.appendChild(cell);
      }
    }

    this.container.appendChild(grid);
  }

  /**
   * Format component type for display (capitalize first letter).
   */
  private formatComponentName(type: HudComponentType): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }
}
