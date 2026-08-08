// Unit tests for MenuOrderEditor — the glasses menu reorder control.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMenuOrderEditor } from "./menu-order-editor";
import { STORAGE_KEYS } from "../storage/schemas";
import { DEFAULT_MENU_ENTRIES } from "./types";

function createMockBridge(storage: Record<string, string> = {}) {
  return {
    getLocalStorage: vi.fn(async (key: string) => storage[key] ?? ""),
    setLocalStorage: vi.fn(async (key: string, value: string) => {
      storage[key] = value;
      return true;
    }),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rowLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".menu-order-editor-list > div > span"),
  ).map((el) => el.textContent ?? "");
}

describe("MenuOrderEditor", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
  });

  it("renders the default entries in registration order when nothing is saved", async () => {
    const editor = createMenuOrderEditor({ bridge: createMockBridge() });
    editor.mount(container);
    await flush();

    expect(rowLabels(container)).toEqual(
      DEFAULT_MENU_ENTRIES.map((e) => e.name),
    );

    editor.unmount();
  });

  it("applies a saved order on load", async () => {
    const bridgeStorage: Record<string, string> = {
      [STORAGE_KEYS.MENU_ORDER]: JSON.stringify(["exit", "reminders"]),
    };
    const editor = createMenuOrderEditor({
      bridge: createMockBridge(bridgeStorage),
    });
    editor.mount(container);
    await flush();

    expect(rowLabels(container)).toEqual([
      "Exit Foresight",
      "Reminders",
      "SmarterEveryday",
    ]);

    editor.unmount();
  });

  it("moving an entry down swaps it with the next one and persists the new order", async () => {
    const bridgeStorage: Record<string, string> = {};
    const editor = createMenuOrderEditor({
      bridge: createMockBridge(bridgeStorage),
    });
    editor.mount(container);
    await flush();

    const firstRowDownBtn = container.querySelector(
      ".menu-order-editor-list > div button:nth-of-type(2)",
    ) as HTMLButtonElement;
    firstRowDownBtn.click();
    await flush();

    expect(rowLabels(container)).toEqual([
      "Reminders",
      "SmarterEveryday",
      "Exit Foresight",
    ]);

    const stored = JSON.parse(bridgeStorage[STORAGE_KEYS.MENU_ORDER]);
    expect(stored).toEqual(["reminders", "smarter-everyday", "exit"]);

    editor.unmount();
  });

  it("disables the up button on the first row and the down button on the last row", async () => {
    const editor = createMenuOrderEditor({ bridge: createMockBridge() });
    editor.mount(container);
    await flush();

    const rows = container.querySelectorAll(".menu-order-editor-list > div");
    const firstUp = rows[0].querySelectorAll("button")[0] as HTMLButtonElement;
    const lastDown = rows[rows.length - 1].querySelectorAll(
      "button",
    )[1] as HTMLButtonElement;

    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);

    editor.unmount();
  });
});
