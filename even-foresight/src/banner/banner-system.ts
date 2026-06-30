import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { BannerNotification, BannerSystem } from "./types";
import type { StorageManager } from "../storage/storage-manager";
import type { BannerConfig } from "../storage/schemas";
import { STORAGE_KEYS } from "../storage/schemas";
import {
  BANNER_DEFAULT_DURATION_S,
  BANNER_MIN_DURATION_S,
  BANNER_MAX_DURATION_S,
  BANNER_MAX_TEXT_LENGTH,
  BANNER_QUEUE_MAX,
} from "../constants";

// === Pure Functions (exported for PBT) ===

/**
 * Truncates banner text to max 50 characters with ellipsis.
 * If text.length <= 50, returns unchanged. Otherwise returns first 47 chars + "...".
 */
export function truncateBannerText(text: string): string {
  if (text.length <= BANNER_MAX_TEXT_LENGTH) {
    return text;
  }
  return text.slice(0, BANNER_MAX_TEXT_LENGTH - 3) + "...";
}

/**
 * Processes the queue when a new notification arrives.
 * If queue.length < 5, appends the new notification.
 * If queue.length >= 5, drops the oldest (index 0) and appends the new one.
 */
export function processQueue(
  queue: BannerNotification[],
  newNotification: BannerNotification,
): BannerNotification[] {
  if (queue.length < BANNER_QUEUE_MAX) {
    return [...queue, newNotification];
  }
  // Drop oldest (index 0), append new
  return [...queue.slice(1), newNotification];
}

/**
 * Processes the queue after the current banner is dismissed.
 * If queue is non-empty, dequeues the first item as the new active banner.
 * If queue is empty, returns null (no active banner).
 */
export function processAfterDismiss(queue: BannerNotification[]): {
  active: BannerNotification | null;
  remainingQueue: BannerNotification[];
} {
  if (queue.length === 0) {
    return { active: null, remainingQueue: [] };
  }
  const [next, ...rest] = queue;
  return { active: next, remainingQueue: rest };
}

/**
 * Clamps a duration value to [BANNER_MIN_DURATION_S, BANNER_MAX_DURATION_S].
 */
export function clampDuration(duration: number): number {
  return Math.max(
    BANNER_MIN_DURATION_S,
    Math.min(BANNER_MAX_DURATION_S, duration),
  );
}

// === Factory ===

export interface BannerSystemOptions {
  /** Override duration for testing (seconds). If provided, skips storage read. */
  defaultDuration?: number;
}

/**
 * Creates a BannerSystem instance.
 *
 * @param bridge - Even App SDK bridge for display operations
 * @param storage - StorageManager for reading banner config (duration)
 * @param options - Optional overrides for testing
 */
export function createBannerSystem(
  bridge: EvenAppBridge,
  storage: StorageManager,
  options?: BannerSystemOptions,
): BannerSystem {
  let activeBanner: BannerNotification | null = null;
  let queue: BannerNotification[] = [];
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let visible = false;

  /**
   * Gets the configured display duration in seconds, clamped to [3, 15].
   */
  function getDurationSeconds(): number {
    if (options?.defaultDuration !== undefined) {
      return clampDuration(options.defaultDuration);
    }
    const config = storage.get<BannerConfig>(STORAGE_KEYS.BANNER_CONFIG);
    if (config && typeof config.displayDurationSeconds === "number") {
      return clampDuration(config.displayDurationSeconds);
    }
    return BANNER_DEFAULT_DURATION_S;
  }

  /**
   * Displays a banner notification on container 0.
   * Timer is set synchronously; display update is fire-and-forget.
   */
  function displayBanner(notification: BannerNotification): void {
    activeBanner = notification;
    visible = true;

    const displayText = truncateBannerText(notification.text);

    // Compute duration: prefer per-notification, then config/default
    const durationMs =
      (notification.duration !== undefined
        ? clampDuration(notification.duration)
        : getDurationSeconds()) * 1000;

    // Set auto-dismiss timer synchronously
    clearDismissTimer();
    dismissTimer = setTimeout(() => {
      system.dismiss();
    }, durationMs);

    // Fire-and-forget display update via SDK
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content: displayText,
      }),
    );
  }

  /**
   * Clears the banner display on container 0.
   */
  function clearDisplay(): void {
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content: "",
      }),
    );
  }

  /**
   * Clears the auto-dismiss timer.
   */
  function clearDismissTimer(): void {
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  /**
   * Processes the next item in the queue after a dismiss.
   */
  function processNext(): void {
    const result = processAfterDismiss(queue);
    queue = result.remainingQueue;

    if (result.active) {
      // Display next banner (well within 500ms requirement)
      displayBanner(result.active);
    } else {
      // No more banners — restore HUD visibility
      activeBanner = null;
      visible = false;
      clearDisplay();
    }
  }

  const system: BannerSystem = {
    push(notification: BannerNotification): void {
      if (!activeBanner) {
        // No banner active — display immediately
        displayBanner(notification);
      } else {
        // Banner is active — add to queue
        queue = processQueue(queue, notification);
      }
    },

    dismiss(): void {
      clearDismissTimer();
      processNext();
    },

    get isVisible(): boolean {
      return visible;
    },
  };

  return system;
}
