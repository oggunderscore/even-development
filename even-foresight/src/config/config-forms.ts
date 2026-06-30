import type { StorageManager } from "../storage/storage-manager";
import type {
  ClockConfig,
  WeatherConfig,
  RemindersStore,
  Reminder,
  BannerConfig,
} from "../storage/schemas";
import {
  STORAGE_KEYS,
  DEFAULT_CLOCK_CONFIG,
  DEFAULT_WEATHER_CONFIG,
  DEFAULT_REMINDERS_STORE,
  DEFAULT_BANNER_CONFIG,
} from "../storage/schemas";
import {
  WEATHER_MIN_INTERVAL_MIN,
  WEATHER_MAX_INTERVAL_MIN,
  WEATHER_LOCATION_MAX_LENGTH,
  REMINDERS_MAX,
  REMINDER_TITLE_MAX_LENGTH,
  BANNER_MIN_DURATION_S,
  BANNER_MAX_DURATION_S,
} from "../constants";

// === Pure Validation Functions (exported for PBT) ===

/**
 * Returns true if value is within [15, 120].
 */
export function validateWeatherRefreshInterval(value: number): boolean {
  return value >= WEATHER_MIN_INTERVAL_MIN && value <= WEATHER_MAX_INTERVAL_MIN;
}

/**
 * Returns true if title length is between 1 and 30 inclusive.
 */
export function validateReminderTitle(title: string): boolean {
  return title.length >= 1 && title.length <= REMINDER_TITLE_MAX_LENGTH;
}

/**
 * Returns true if location length is between 1 and 50 inclusive.
 */
export function validateWeatherLocation(location: string): boolean {
  return location.length >= 1 && location.length <= WEATHER_LOCATION_MAX_LENGTH;
}

/**
 * Clamps value to [3, 15].
 */
export function clampBannerDuration(value: number): number {
  return Math.min(
    BANNER_MAX_DURATION_S,
    Math.max(BANNER_MIN_DURATION_S, value),
  );
}

// === Error result types ===

export interface ConfigResult<T = void> {
  success: boolean;
  value?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}

// === Clock Config Form ===

export class ClockConfigForm {
  private config: ClockConfig;

  constructor(private storage: StorageManager) {
    this.config = storage.get<ClockConfig>(STORAGE_KEYS.CLOCK_CONFIG) ?? {
      ...DEFAULT_CLOCK_CONFIG,
    };
  }

  getFormat(): ClockConfig["format"] {
    return this.config.format;
  }

  async setFormat(format: "12h" | "24h"): Promise<ConfigResult> {
    this.config = { format };
    await this.storage.set(STORAGE_KEYS.CLOCK_CONFIG, this.config);
    return { success: true };
  }
}

// === Weather Config Form ===

export class WeatherConfigForm {
  private config: WeatherConfig;

  constructor(private storage: StorageManager) {
    this.config = storage.get<WeatherConfig>(STORAGE_KEYS.WEATHER_CONFIG) ?? {
      ...DEFAULT_WEATHER_CONFIG,
    };
  }

  getConfig(): WeatherConfig {
    return { ...this.config };
  }

  async setLocation(location: string): Promise<ConfigResult> {
    if (!validateWeatherLocation(location)) {
      return {
        success: false,
        fieldErrors: {
          location: `Location must be between 1 and ${WEATHER_LOCATION_MAX_LENGTH} characters`,
        },
      };
    }
    this.config = { ...this.config, location };
    await this.storage.set(STORAGE_KEYS.WEATHER_CONFIG, this.config);
    return { success: true };
  }

  async setUnit(unit: "fahrenheit" | "celsius"): Promise<ConfigResult> {
    this.config = { ...this.config, unit };
    await this.storage.set(STORAGE_KEYS.WEATHER_CONFIG, this.config);
    return { success: true };
  }

  async setRefreshInterval(minutes: number): Promise<ConfigResult> {
    if (!validateWeatherRefreshInterval(minutes)) {
      return {
        success: false,
        fieldErrors: {
          refreshInterval: `Refresh interval must be between ${WEATHER_MIN_INTERVAL_MIN} and ${WEATHER_MAX_INTERVAL_MIN} minutes`,
        },
      };
    }
    this.config = { ...this.config, refreshIntervalMinutes: minutes };
    await this.storage.set(STORAGE_KEYS.WEATHER_CONFIG, this.config);
    return { success: true };
  }
}

// === Reminders Config Form ===

export class RemindersConfigForm {
  private store: RemindersStore;

  constructor(private storage: StorageManager) {
    this.store = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS) ?? {
      ...DEFAULT_REMINDERS_STORE,
      reminders: [],
    };
  }

  getReminders(): Reminder[] {
    return [...this.store.reminders];
  }

  async addReminder(
    title: string,
    targetTime: number,
    currentTime: number = Date.now(),
  ): Promise<ConfigResult<Reminder>> {
    if (!validateReminderTitle(title)) {
      return {
        success: false,
        fieldErrors: {
          title: `Reminder title must be between 1 and ${REMINDER_TITLE_MAX_LENGTH} characters`,
        },
      };
    }

    if (targetTime <= currentTime) {
      return {
        success: false,
        fieldErrors: {
          targetTime: "Reminder time must be in the future",
        },
      };
    }

    if (this.store.reminders.length >= REMINDERS_MAX) {
      return {
        success: false,
        error: `Maximum of ${REMINDERS_MAX} reminders reached`,
      };
    }

    const reminder: Reminder = {
      id: crypto.randomUUID(),
      title,
      targetTime,
      completed: false,
    };

    this.store = {
      reminders: [...this.store.reminders, reminder],
    };
    await this.storage.set(STORAGE_KEYS.REMINDERS, this.store);
    return { success: true, value: reminder };
  }

  async deleteReminder(id: string): Promise<ConfigResult> {
    const index = this.store.reminders.findIndex((r) => r.id === id);
    if (index === -1) {
      return {
        success: false,
        error: "Reminder not found",
      };
    }

    this.store = {
      reminders: this.store.reminders.filter((r) => r.id !== id),
    };
    await this.storage.set(STORAGE_KEYS.REMINDERS, this.store);
    return { success: true };
  }
}

// === Banner Config Form ===

export class BannerConfigForm {
  private config: BannerConfig;

  constructor(private storage: StorageManager) {
    this.config = storage.get<BannerConfig>(STORAGE_KEYS.BANNER_CONFIG) ?? {
      ...DEFAULT_BANNER_CONFIG,
    };
  }

  getDuration(): number {
    return this.config.displayDurationSeconds;
  }

  async setDuration(seconds: number): Promise<ConfigResult<number>> {
    const clamped = clampBannerDuration(seconds);
    this.config = { displayDurationSeconds: clamped };
    await this.storage.set(STORAGE_KEYS.BANNER_CONFIG, this.config);
    return { success: true, value: clamped };
  }
}
