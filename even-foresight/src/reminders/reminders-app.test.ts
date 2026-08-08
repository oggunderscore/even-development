import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRemindersApp } from "./reminders-app";
import { createFakeStorage, type FakeStorage } from "../storage/storage-manager.test-utils";
import { STORAGE_KEYS, type Reminder, type RemindersStore } from "../storage/schemas";
import { REMINDER_UNDO_WINDOW_MS } from "../constants";
import type { SubApp, SubAppContext, GestureEvent } from "../sub-app/types";

function reminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "1",
    title: "Standup",
    targetTime: Date.now() + 1_000,
    completed: false,
    ...overrides,
  };
}

interface FakeContext extends SubAppContext {
  renders: Array<{ containerId: number; content: string }>;
}

function createFakeContext(): FakeContext {
  const renders: Array<{ containerId: number; content: string }> = [];
  return {
    width: 576,
    height: 173,
    yOffset: 115,
    async updateContent(containerId: number, content: string): Promise<void> {
      renders.push({ containerId, content });
    },
    requestContainers(count: number): number[] {
      return Array.from({ length: count }, (_, i) => 100 + i);
    },
    renders,
  };
}

function lastRender(ctx: FakeContext): string {
  return ctx.renders[ctx.renders.length - 1]?.content ?? "";
}

function gesture(type: GestureEvent["type"]): GestureEvent {
  return { type, timestamp: Date.now() };
}

describe("createRemindersApp", () => {
  let storage: FakeStorage;
  let app: SubApp;
  let ctx: FakeContext;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = createFakeStorage();
    app = createRemindersApp(storage);
    ctx = createFakeContext();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a placeholder when there are no reminders", async () => {
    await app.activate(ctx);
    expect(lastRender(ctx)).toBe("No reminders");
  });

  it("renders reminders in chronological order with the first one highlighted", async () => {
    const store: RemindersStore = {
      reminders: [
        reminder({ id: "a", title: "Second", targetTime: 2000 }),
        reminder({ id: "b", title: "First", targetTime: 1000 }),
      ],
    };
    storage.seed(STORAGE_KEYS.REMINDERS, store);

    await app.activate(ctx);
    const lines = lastRender(ctx).split("\n");
    expect(lines[0]).toContain("First");
    expect(lines[0].startsWith("> ")).toBe(true);
    expect(lines[1]).toContain("Second");
    expect(lines[1].startsWith("  ")).toBe(true);
  });

  it("swipe-down moves the highlight to the next reminder", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [
        reminder({ id: "a", title: "First", targetTime: 1000 }),
        reminder({ id: "b", title: "Second", targetTime: 2000 }),
      ],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("swipe-down"));
    const lines = lastRender(ctx).split("\n");
    expect(lines[1].startsWith("> ")).toBe(true);
    expect(lines[1]).toContain("Second");
  });

  it("swipe-up does not move the highlight above the first entry", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Only", targetTime: 1000 })],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("swipe-up"));
    const lines = lastRender(ctx).split("\n");
    expect(lines[0].startsWith("> ")).toBe(true);
  });

  it("a tap marks the highlighted reminder completed, struck through, with completedAt persisted", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("single-tap"));
    await Promise.resolve();

    const stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders[0].completed).toBe(true);
    expect(stored.reminders[0].completedAt).toBeTypeOf("number");
    expect(lastRender(ctx)).toContain("̶");
  });

  it("a second tap within the undo window un-completes the reminder", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("single-tap")); // complete
    await Promise.resolve();
    app.handleGesture(gesture("single-tap")); // undo
    await Promise.resolve();

    const stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders[0].completed).toBe(false);
    expect(stored.reminders[0].completedAt).toBeUndefined();
    expect(lastRender(ctx)).not.toContain("̶");
  });

  it("deletes the reminder once the undo window elapses without a second tap", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("single-tap"));
    await Promise.resolve();

    let stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(REMINDER_UNDO_WINDOW_MS + 1);

    stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders).toHaveLength(0);
    expect(lastRender(ctx)).toBe("No reminders");
  });

  it("still deletes the reminder after the undo window even if the app was closed first", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);

    app.handleGesture(gesture("single-tap"));
    await Promise.resolve();
    await app.cleanup();

    await vi.advanceTimersByTimeAsync(REMINDER_UNDO_WINDOW_MS + 1);

    const stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders).toHaveLength(0);
  });

  it("cleanup clears the rendered container", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);
    await app.cleanup();

    expect(lastRender(ctx)).toBe("");
  });

  it("ignores double-tap and hold gestures", async () => {
    storage.seed(STORAGE_KEYS.REMINDERS, {
      reminders: [reminder({ id: "a", title: "Standup", targetTime: 1000 })],
    });
    await app.activate(ctx);
    const rendersBefore = ctx.renders.length;

    app.handleGesture(gesture("double-tap"));
    app.handleGesture(gesture("hold"));

    expect(ctx.renders.length).toBe(rendersBefore);
    const stored = storage.get<RemindersStore>(STORAGE_KEYS.REMINDERS)!;
    expect(stored.reminders[0].completed).toBe(false);
  });
});
