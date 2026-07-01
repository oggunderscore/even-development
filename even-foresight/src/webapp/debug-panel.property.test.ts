import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createNotificationPayload,
  createNewslinePayload,
  createWeatherPayload,
  appendToLog,
} from "./debug-panel";
import type { DebugMessage, WeatherPayload } from "./types";

/**
 * Feature: foresight-webapp-ui, Property 13: Debug text payload construction
 *
 * For valid notification (1–50 chars) or newsline (1–100 chars), payload
 * contains exact text + valid ISO 8601 timestamp.
 *
 * Validates: Requirements 10.2, 10.3
 */

/**
 * Feature: foresight-webapp-ui, Property 14: Debug weather payload construction
 *
 * For valid temperature [-100, 150], condition from allowed set, and unit,
 * payload contains all fields + ISO 8601 timestamp.
 *
 * Validates: Requirements 10.4
 */

/**
 * Feature: foresight-webapp-ui, Property 15: Debug log bounded size with FIFO eviction
 *
 * Log never exceeds 50 entries; on append to full log, oldest removed, new at end.
 *
 * Validates: Requirements 10.7
 */

// --- Arbitraries ---

const arbNotificationText = fc.string({ minLength: 1, maxLength: 50 });

const arbNewslineText = fc.string({ minLength: 1, maxLength: 100 });

const arbTemperature = fc.integer({ min: -100, max: 150 });

const arbCondition: fc.Arbitrary<WeatherPayload["condition"]> = fc.constantFrom(
  "clear",
  "cloudy",
  "partly cloudy",
  "rain",
  "thunderstorm",
  "snow",
  "fog",
);

const arbUnit: fc.Arbitrary<WeatherPayload["unit"]> = fc.constantFrom(
  "fahrenheit",
  "celsius",
);

const arbDebugMessage: fc.Arbitrary<DebugMessage> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom("notification", "newsline", "weather") as fc.Arbitrary<
    DebugMessage["type"]
  >,
  content: fc.string({ minLength: 1, maxLength: 100 }),
  timestamp: fc
    .integer({ min: 946684800000, max: 4102444799000 })
    .map((ms) => new Date(ms).toISOString()),
});

// --- Property 13: Debug text payload construction ---

describe("Feature: foresight-webapp-ui, Property 13: Debug text payload construction", () => {
  it("notification payload contains exact text (sliced to 50) and valid ISO 8601 timestamp", () => {
    fc.assert(
      fc.property(arbNotificationText, (text) => {
        const payload = createNotificationPayload(text);

        // payload.text should equal text sliced to max 50 chars
        expect(payload.text).toBe(text.slice(0, 50));

        // payload.type should be "notification"
        expect(payload.type).toBe("notification");

        // payload.timestamp should be a valid ISO 8601 date
        expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("newsline payload contains exact text (sliced to 100) and valid ISO 8601 timestamp", () => {
    fc.assert(
      fc.property(arbNewslineText, (text) => {
        const payload = createNewslinePayload(text);

        // payload.text should equal text sliced to max 100 chars
        expect(payload.text).toBe(text.slice(0, 100));

        // payload.type should be "newsline"
        expect(payload.type).toBe("newsline");

        // payload.timestamp should be a valid ISO 8601 date
        expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 14: Debug weather payload construction ---

describe("Feature: foresight-webapp-ui, Property 14: Debug weather payload construction", () => {
  it("weather payload contains all fields matching inputs + valid ISO 8601 timestamp", () => {
    fc.assert(
      fc.property(
        arbTemperature,
        arbCondition,
        arbUnit,
        (temperature, condition, unit) => {
          const payload = createWeatherPayload(temperature, condition, unit);

          // All fields should match inputs
          expect(payload.type).toBe("weather");
          expect(payload.temperature).toBe(temperature);
          expect(payload.condition).toBe(condition);
          expect(payload.unit).toBe(unit);

          // Timestamp should be valid ISO 8601
          expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 15: Debug log bounded size with FIFO eviction ---

describe("Feature: foresight-webapp-ui, Property 15: Debug log bounded size with FIFO eviction", () => {
  it("appendToLog result never exceeds 50 entries for any log of ≤ 50 entries", () => {
    fc.assert(
      fc.property(
        fc.array(arbDebugMessage, { minLength: 0, maxLength: 50 }),
        arbDebugMessage,
        (log, entry) => {
          const result = appendToLog(log, entry, 50);

          // Result should never exceed 50
          expect(result.length).toBeLessThanOrEqual(50);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("full log (50 entries) + append: length stays 50, last entry is new, first of original is gone", () => {
    fc.assert(
      fc.property(
        fc.array(arbDebugMessage, { minLength: 50, maxLength: 50 }),
        arbDebugMessage,
        (log, entry) => {
          const result = appendToLog(log, entry, 50);

          // Length stays at 50
          expect(result.length).toBe(50);

          // Last entry is the new one
          expect(result[result.length - 1]).toEqual(entry);

          // First entry of original log is gone (evicted via FIFO)
          expect(result[0]).toEqual(log[1]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("result never exceeds maxSize regardless of input log size", () => {
    fc.assert(
      fc.property(
        fc.array(arbDebugMessage, { minLength: 0, maxLength: 60 }),
        arbDebugMessage,
        (log, entry) => {
          const result = appendToLog(log, entry, 50);

          // Result should never exceed 50
          expect(result.length).toBeLessThanOrEqual(50);
        },
      ),
      { numRuns: 100 },
    );
  });
});
