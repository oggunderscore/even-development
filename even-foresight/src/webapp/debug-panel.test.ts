// Unit tests for DebugPanel's actual delivery paths — regression coverage
// for the bug where "Notification"/"Weather" sends wrote to storage keys
// nothing read, so nothing ever reached the HUD.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDebugPanel,
  mapDebugConditionToWeatherCondition,
} from "./debug-panel";
import { STORAGE_KEYS } from "./types";
import type { WeatherCache } from "../storage/schemas";

function createMockBridge(storage: Record<string, string> = {}) {
  return {
    getLocalStorage: vi.fn(async (key: string) => storage[key] ?? ""),
    setLocalStorage: vi.fn(async (key: string, value: string) => {
      storage[key] = value;
      return true;
    }),
  };
}

function byAriaLabel<T extends Element>(root: HTMLElement, label: string): T {
  const el = root.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No element with aria-label "${label}"`);
  return el as T;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("mapDebugConditionToWeatherCondition", () => {
  it("maps every debug condition to a distinct WeatherCondition", () => {
    const conditions: Array<
      Parameters<typeof mapDebugConditionToWeatherCondition>[0]
    > = ["clear", "cloudy", "partly cloudy", "rain", "thunderstorm", "snow", "fog"];
    const mapped = conditions.map(mapDebugConditionToWeatherCondition);
    expect(mapped).toEqual([
      "sunny",
      "cloudy",
      "partly-cloudy",
      "rainy",
      "stormy",
      "snowy",
      "foggy",
    ]);
    expect(new Set(mapped).size).toBe(conditions.length);
  });
});

describe("DebugPanel notification send", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("dispatches foresight-debug-notification instead of writing a dead storage key", async () => {
    const bridgeStorage: Record<string, string> = {};
    const bridge = createMockBridge(bridgeStorage);
    const panel = createDebugPanel({ bridge });
    panel.mount(container);
    await flush();

    const received: string[] = [];
    const listener = (e: Event) => {
      received.push((e as CustomEvent).detail?.text);
    };
    window.addEventListener("foresight-debug-notification", listener);

    const input = byAriaLabel<HTMLInputElement>(container, "Notification text");
    input.value = "Take a break";
    input.dispatchEvent(new Event("input"));

    byAriaLabel<HTMLButtonElement>(container, "Send notification").click();
    await flush();

    expect(received).toEqual(["Take a break"]);
    expect(bridgeStorage["foresight-debug-notification"]).toBeUndefined();
    expect(container.textContent).toContain("Take a break");

    window.removeEventListener("foresight-debug-notification", listener);
    panel.unmount();
  });
});

describe("DebugPanel weather send", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
  });

  it("writes STORAGE_KEYS.WEATHER_CACHE with a mapped condition instead of a dead key", async () => {
    const bridgeStorage: Record<string, string> = {};
    const bridge = createMockBridge(bridgeStorage);
    const panel = createDebugPanel({ bridge });
    panel.mount(container);
    await flush();

    const tempInput = byAriaLabel<HTMLInputElement>(container, "Temperature");
    tempInput.value = "80";
    const conditionSelect = byAriaLabel<HTMLSelectElement>(
      container,
      "Weather condition",
    );
    conditionSelect.value = "partly cloudy";
    const unitSelect = byAriaLabel<HTMLSelectElement>(
      container,
      "Temperature unit",
    );
    unitSelect.value = "fahrenheit";

    byAriaLabel<HTMLButtonElement>(container, "Send weather update").click();
    await flush();

    expect(bridgeStorage["foresight-debug-weather"]).toBeUndefined();
    const cache = JSON.parse(
      bridgeStorage[STORAGE_KEYS.WEATHER_CACHE],
    ) as WeatherCache;
    expect(cache.temperature).toBe(80);
    expect(cache.condition).toBe("partly-cloudy");
    expect(cache.unit).toBe("fahrenheit");
    expect(typeof cache.fetchedAt).toBe("number");
    expect(container.textContent).toContain("80° F, partly cloudy");

    panel.unmount();
  });
});
