import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import {
  HUD_SLOT_WIDTH,
  HUD_ROW_HEIGHT,
  HUD_ROW_GAP,
  DISPLAY_WIDTH,
  HUD_HEIGHT,
} from "../constants";

/**
 * Represents a computed slot rectangle on the HUD display.
 */
export interface SlotPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure function that calculates the pixel position of a HUD slot.
 *
 * Layout: 2 rows × 5 columns
 * - x = col × 115
 * - y = row × 58 (where 58 = 57 height + 1 gap)
 * - width = 115
 * - height = 57
 */
export function calculateSlotPosition(
  row: 0 | 1,
  col: 0 | 1 | 2 | 3 | 4,
): SlotPosition {
  const rowStep = HUD_ROW_HEIGHT + HUD_ROW_GAP; // 57 + 1 = 58
  return {
    x: col * HUD_SLOT_WIDTH,
    y: row * rowStep,
    width: HUD_SLOT_WIDTH,
    height: HUD_ROW_HEIGHT,
  };
}

/**
 * Validates that a slot position fits within the HUD display bounds.
 * - x + width must be ≤ DISPLAY_WIDTH (576)
 * - y + height must be ≤ HUD_HEIGHT (115)
 */
export function isSlotPositionValid(position: SlotPosition): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.width > 0 &&
    position.height > 0 &&
    position.x + position.width <= DISPLAY_WIDTH &&
    position.y + position.height <= HUD_HEIGHT
  );
}

/**
 * Converts a (row, col) pair to a container ID (1–10).
 * Container IDs 1–10 are reserved for HUD slots.
 * Layout: row 0 cols 0–4 → IDs 1–5, row 1 cols 0–4 → IDs 6–10.
 */
export function slotToContainerId(row: 0 | 1, col: 0 | 1 | 2 | 3 | 4): number {
  return row * 5 + col + 1;
}

/**
 * Renders HUD content into the single HUD container (container 1).
 * All slot content is composed into a single text string.
 */
export class HudSlotRenderer {
  constructor(private readonly bridge: EvenAppBridge) {}

  /**
   * Renders the given content string into the HUD container.
   * Since we use a single container for all HUD content,
   * the caller should compose the full HUD text.
   */
  async renderSlot(
    _row: 0 | 1,
    _col: 0 | 1 | 2 | 3 | 4,
    content: string,
  ): Promise<void> {
    // In single-container mode, individual slot renders update container 0
    // The HudManager orchestrates full content composition
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content,
      }),
    );
  }

  /**
   * Renders composed HUD content (all slots) into the HUD container.
   */
  async renderAll(content: string): Promise<void> {
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content,
      }),
    );
  }

  /**
   * Clears the HUD display.
   */
  async clearSlot(_row: 0 | 1, _col: 0 | 1 | 2 | 3 | 4): Promise<void> {
    await this.renderAll("");
  }
}
