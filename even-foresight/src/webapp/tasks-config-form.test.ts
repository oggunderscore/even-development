// Unit tests for TasksConfigForm — the Reminders manager.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTasksConfigForm,
  epochToDatetimeLocal,
  datetimeLocalToEpoch,
} from "./tasks-config-form";
import { STORAGE_KEYS, type RemindersStore } from "../storage/schemas";
import { REMINDERS_MAX } from "../constants";

function createMockBridge(storage: Record<string, string> = {}) {
  return {
    getLocalStorage: vi.fn(async (key: string) => storage[key] ?? ""),
    setLocalStorage: vi.fn(async (key: string, value: string) => {
      storage[key] = value;
      return true;
    }),
  };
}

function seedReminders(
  storage: Record<string, string>,
  store: RemindersStore,
): void {
  storage[STORAGE_KEYS.REMINDERS] = JSON.stringify(store);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("datetime-local conversion", () => {
  it("round-trips through epochToDatetimeLocal/datetimeLocalToEpoch at minute granularity", () => {
    const now = new Date(2026, 0, 15, 9, 30, 0, 0).getTime();
    const str = epochToDatetimeLocal(now);
    expect(str).toBe("2026-01-15T09:30");
    expect(datetimeLocalToEpoch(str)).toBe(now);
  });

  it("returns NaN for unparseable input", () => {
    expect(Number.isNaN(datetimeLocalToEpoch("not-a-date"))).toBe(true);
  });
});

describe("TasksConfigForm", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    container.remove();
  });

  it("shows an empty state and an enabled Add button with no reminders", async () => {
    const form = createTasksConfigForm({
      bridge: createMockBridge(),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    expect(container.textContent).toContain("No reminders yet.");
    const addBtn = container.querySelector(
      ".tasks-add-reminder-btn",
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);

    form.unmount();
  });

  it("adds a reminder with a title and a future time", async () => {
    const bridgeStorage: Record<string, string> = {};
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    (
      container.querySelector(".tasks-add-reminder-btn") as HTMLButtonElement
    ).click();

    const titleInput = container.querySelector(
      '.tasks-reminder-editor input[type="text"]',
    ) as HTMLInputElement;
    const timeInput = container.querySelector(
      '.tasks-reminder-editor input[type="datetime-local"]',
    ) as HTMLInputElement;
    titleInput.value = "Take a break";
    timeInput.value = epochToDatetimeLocal(Date.now() + 3_600_000);

    (
      Array.from(container.querySelectorAll(".tasks-reminder-editor button")).find(
        (b) => b.textContent === "Add Reminder",
      ) as HTMLButtonElement
    ).click();
    await flush();

    expect(container.textContent).toContain("Take a break");
    expect(container.querySelector(".tasks-reminder-editor")).toBeNull();

    const stored = JSON.parse(
      bridgeStorage[STORAGE_KEYS.REMINDERS],
    ) as RemindersStore;
    expect(stored.reminders).toHaveLength(1);
    expect(stored.reminders[0].title).toBe("Take a break");
    expect(stored.reminders[0].completed).toBe(false);

    form.unmount();
  });

  it("rejects an empty title without persisting", async () => {
    const bridgeStorage: Record<string, string> = {};
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    (
      container.querySelector(".tasks-add-reminder-btn") as HTMLButtonElement
    ).click();

    const timeInput = container.querySelector(
      '.tasks-reminder-editor input[type="datetime-local"]',
    ) as HTMLInputElement;
    timeInput.value = epochToDatetimeLocal(Date.now() + 3_600_000);

    (
      Array.from(container.querySelectorAll(".tasks-reminder-editor button")).find(
        (b) => b.textContent === "Add Reminder",
      ) as HTMLButtonElement
    ).click();
    await flush();

    expect(container.textContent).toContain("Title must be");
    expect(bridgeStorage[STORAGE_KEYS.REMINDERS]).toBeUndefined();

    form.unmount();
  });

  it("rejects a time that is not in the future", async () => {
    const bridgeStorage: Record<string, string> = {};
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    (
      container.querySelector(".tasks-add-reminder-btn") as HTMLButtonElement
    ).click();

    const titleInput = container.querySelector(
      '.tasks-reminder-editor input[type="text"]',
    ) as HTMLInputElement;
    const timeInput = container.querySelector(
      '.tasks-reminder-editor input[type="datetime-local"]',
    ) as HTMLInputElement;
    titleInput.value = "Yesterday's task";
    timeInput.value = epochToDatetimeLocal(Date.now() - 3_600_000);

    (
      Array.from(container.querySelectorAll(".tasks-reminder-editor button")).find(
        (b) => b.textContent === "Add Reminder",
      ) as HTMLButtonElement
    ).click();
    await flush();

    expect(container.textContent).toContain("future");
    expect(bridgeStorage[STORAGE_KEYS.REMINDERS]).toBeUndefined();

    form.unmount();
  });

  it("deletes a reminder", async () => {
    const bridgeStorage: Record<string, string> = {};
    seedReminders(bridgeStorage, {
      reminders: [
        {
          id: "r1",
          title: "Take a break",
          targetTime: Date.now() + 3_600_000,
          completed: false,
        },
      ],
    });
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    expect(container.textContent).toContain("Take a break");

    (
      container.querySelector(".tasks-reminder-btn") as HTMLButtonElement
    ).click();
    await flush();

    expect(container.textContent).not.toContain("Take a break");
    expect(container.textContent).toContain("No reminders yet.");

    const stored = JSON.parse(
      bridgeStorage[STORAGE_KEYS.REMINDERS],
    ) as RemindersStore;
    expect(stored.reminders).toHaveLength(0);

    form.unmount();
  });

  it("disables Add and shows a limit note once REMINDERS_MAX is reached", async () => {
    const bridgeStorage: Record<string, string> = {};
    seedReminders(bridgeStorage, {
      reminders: Array.from({ length: REMINDERS_MAX }, (_, i) => ({
        id: `r${i}`,
        title: `Reminder ${i}`,
        targetTime: Date.now() + 3_600_000 + i,
        completed: false,
      })),
    });
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    const addBtn = container.querySelector(
      ".tasks-add-reminder-btn",
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    expect(container.textContent).toContain(
      `Limit of ${REMINDERS_MAX} reminders reached.`,
    );

    form.unmount();
  });

  it("marks a completed reminder as Done and shows it struck through", async () => {
    const bridgeStorage: Record<string, string> = {};
    seedReminders(bridgeStorage, {
      reminders: [
        {
          id: "r1",
          title: "Standup",
          targetTime: Date.now() - 1000,
          completed: true,
          completedAt: Date.now(),
        },
      ],
    });
    const form = createTasksConfigForm({
      bridge: createMockBridge(bridgeStorage),
      onBack: () => {},
    });
    form.mount(container);
    await flush();

    expect(container.textContent).toContain("Done");

    form.unmount();
  });
});
