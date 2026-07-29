import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { pxTruncate } from "@evenrealities/pretext";
import {
  HUD_SLOT_WIDTH,
  HUD_HEIGHT,
  HUD_Y,
  HUD_COLS,
  HUD_ROWS,
  DISPLAY_WIDTH,
  CONTAINER,
  CONTAINER_NAME,
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
 * Pure function that calculates the pixel position of a HUD column container.
 *
 * Both grid rows share one container per column — row 0 renders on the first
 * text line, row 1 on the second — so the rectangle depends only on `col`.
 */
export function calculateSlotPosition(col: number): SlotPosition {
  return {
    x: col * HUD_SLOT_WIDTH,
    y: HUD_Y,
    width: HUD_SLOT_WIDTH,
    height: HUD_HEIGHT,
  };
}

/**
 * Validates that a slot position fits within the display bounds.
 */
export function isSlotPositionValid(position: SlotPosition): boolean {
  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.width > 0 &&
    position.height > 0 &&
    position.x + position.width <= DISPLAY_WIDTH &&
    position.y + position.height <= HUD_Y + HUD_HEIGHT
  );
}

/**
 * Returns true when (row, col) addresses a cell inside the 2x5 HUD grid.
 */
export function isSlotInBounds(row: number, col: number): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < HUD_ROWS &&
    col >= 0 &&
    col < HUD_COLS
  );
}

/**
 * Maps a HUD column to its container ID.
 */
export function colToContainerId(col: number): number {
  return CONTAINER.HUD_COL_BASE + col;
}

/**
 * Trims one slot's text so it renders on a single line in a HUD column.
 *
 * A column is only 115px wide and holds exactly two lines — row 0 then row 1.
 * Without this, a wide row-0 value ("78°F P.Cloudy" measures 121px) wraps and
 * pushes row 1 off the bottom of the container, so a widget the user placed
 * simply vanishes. Measurement is pixel-accurate against the firmware's font
 * rather than a character-count guess, because the font is proportional.
 */
export function fitToColumn(
  content: string,
  maxWidth: number = HUD_SLOT_WIDTH,
): string {
  // Newlines would consume the other row's line.
  const singleLine = content.replace(/\s*\n\s*/g, " ").trim();
  if (!singleLine) return "";
  return pxTruncate(singleLine, maxWidth);
}

/**
 * Writes text into the HUD's five column containers.
 *
 * Holds the last content written to each container and skips redundant
 * bridge calls, so a 60-second refresh where nothing changed (the common
 * case for a clock that has not ticked past a minute) costs zero BLE
 * traffic. `reset()` drops that memo when the page is rebuilt underneath us.
 */
export class HudSlotRenderer {
  private readonly lastContent = new Map<number, string>();

  constructor(private readonly bridge: EvenAppBridge) {}

  /**
   * Renders content into a HUD column container.
   * Returns true when a bridge call was actually issued.
   */
  async renderColumn(col: number, content: string): Promise<boolean> {
    const containerID = colToContainerId(col);
    if (this.lastContent.get(containerID) === content) {
      return false;
    }
    this.lastContent.set(containerID, content);

    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID,
        containerName: CONTAINER_NAME.hudCol(col),
        content,
      }),
    );
    return true;
  }

  /**
   * Clears every HUD column.
   */
  async clearAll(): Promise<void> {
    for (let col = 0; col < HUD_COLS; col++) {
      await this.renderColumn(col, "");
    }
  }

  /**
   * Forgets the memoized content so the next render always writes through.
   * Call after any `rebuildPageContainer`, which resets container contents.
   */
  reset(): void {
    this.lastContent.clear();
  }
}
