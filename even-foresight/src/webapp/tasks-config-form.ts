// Feature: foresight-webapp-ui
// TasksConfigForm — the Reminders manager. Accessible from the Apps list
// when tapping Reminders. Add/delete reminders with a title and an optional
// timestamp; the on-glasses Reminders screen (src/reminders/reminders-app.ts)
// is where they get marked complete. Follows the same
// ViewRoute/mount-unmount/loadConfig/saveConfig structure as
// smarter-everyday-config-form.ts.

import type { ViewRoute } from "./types";
import type { ClockConfig, Reminder, RemindersStore } from "../storage/schemas";
import {
  DEFAULT_CLOCK_CONFIG,
  emptyRemindersStore,
  STORAGE_KEYS,
} from "../storage/schemas";
import {
  canAddReminder,
  deleteReminder,
  formatReminderTime,
  validateReminder,
} from "../hud/components/reminders";
import { sortRemindersChronologically } from "../reminders/reminders-list";
import { REMINDERS_MAX, REMINDER_TITLE_MAX_LENGTH } from "../constants";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface TasksConfigFormOptions {
  bridge: any | null;
  onBack: () => void;
}

/**
 * Converts an epoch-ms timestamp to the local `"YYYY-MM-DDTHH:mm"` string a
 * `<input type="datetime-local">` expects. Exported for testing.
 */
export function epochToDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Parses a `<input type="datetime-local">` value (interpreted in the
 * browser's local timezone) back to epoch ms. Returns `NaN` for unparseable
 * input. Exported for testing.
 */
export function datetimeLocalToEpoch(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export function createTasksConfigForm(
  options: TasksConfigFormOptions,
): ViewRoute {
  const { bridge, onBack } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  let reminders: Reminder[] = [];
  let clockFormat: "12h" | "24h" = DEFAULT_CLOCK_CONFIG.format;
  let editorOpen = false;

  let listContainer: HTMLElement | null = null;
  let editorContainer: HTMLElement | null = null;
  let errorEl: HTMLElement | null = null;

  let titleInput: HTMLInputElement | null = null;
  let titleError: HTMLElement | null = null;
  let timeInput: HTMLInputElement | null = null;
  let timeError: HTMLElement | null = null;

  function clearError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }
  }

  // ── Reminder list ──

  function renderReminderRow(reminder: Reminder): HTMLElement {
    const row = document.createElement("div");
    row.className = "tasks-reminder-row";
    row.dataset.reminderId = reminder.id;
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:12px;color:var(--text);margin-bottom:4px;word-break:break-word;${
      reminder.completed ? "text-decoration:line-through;color:var(--text-dim);" : ""
    }`;
    titleEl.textContent = reminder.title;
    info.appendChild(titleEl);

    const metaEl = document.createElement("div");
    metaEl.style.cssText = "font-size:10px;color:var(--text-dim);";
    const dateStr = new Date(reminder.targetTime).toLocaleDateString();
    const timeStr = formatReminderTime(reminder.targetTime, clockFormat);
    metaEl.textContent = reminder.completed
      ? `${dateStr} ${timeStr} · Done`
      : `${dateStr} ${timeStr}`;
    info.appendChild(metaEl);

    row.appendChild(info);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tasks-reminder-btn";
    deleteBtn.style.cssText =
      "padding:6px 10px;border:1px solid var(--error);background:transparent;color:var(--error);font-size:10px;font-family:var(--font);text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;flex-shrink:0;";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      void handleDelete(reminder.id);
    });
    row.appendChild(deleteBtn);

    return row;
  }

  function refreshList(): void {
    if (!listContainer) return;
    listContainer.innerHTML = "";

    const sorted = sortRemindersChronologically(reminders);
    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "font-size:11px;color:var(--text-dim);font-style:italic;padding:8px 0;";
      empty.textContent = "No reminders yet.";
      listContainer.appendChild(empty);
    } else {
      for (const reminder of sorted) {
        listContainer.appendChild(renderReminderRow(reminder));
      }
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "tasks-add-reminder-btn";
    addBtn.style.cssText =
      "width:100%;margin-top:12px;padding:10px 0;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-family:var(--font);text-transform:uppercase;letter-spacing:1px;cursor:pointer;";
    addBtn.textContent = "+ Add Reminder";
    addBtn.disabled = !canAddReminder(reminders);
    addBtn.addEventListener("click", () => {
      openEditor();
    });
    listContainer.appendChild(addBtn);

    if (!canAddReminder(reminders)) {
      const limitNote = document.createElement("div");
      limitNote.style.cssText =
        "font-size:10px;color:var(--text-dim);text-align:center;margin-top:6px;";
      limitNote.textContent = `Limit of ${REMINDERS_MAX} reminders reached.`;
      listContainer.appendChild(limitNote);
    }
  }

  // ── Editor (add) ──

  function openEditor(): void {
    editorOpen = true;
    clearError();
    renderEditor();
  }

  function closeEditor(): void {
    editorOpen = false;
    if (editorContainer) editorContainer.innerHTML = "";
  }

  function renderEditor(): void {
    if (!editorContainer || !editorOpen) return;
    editorContainer.innerHTML = "";

    const form = document.createElement("div");
    form.className = "tasks-reminder-editor";
    form.style.cssText =
      "border:1px solid var(--border);padding:12px;margin:12px 0;background:var(--surface);";

    const titleHeading = document.createElement("h4");
    titleHeading.style.cssText =
      "font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;";
    titleHeading.textContent = "New Reminder";
    form.appendChild(titleHeading);

    const titleLabel = document.createElement("label");
    titleLabel.style.cssText =
      "display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;";
    titleLabel.textContent = "Title";
    form.appendChild(titleLabel);

    titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.maxLength = REMINDER_TITLE_MAX_LENGTH;
    titleInput.placeholder = "e.g. Take a break";
    titleInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;margin-bottom:4px;";
    titleInput.addEventListener("input", () => {
      if (titleError) titleError.textContent = "";
    });
    form.appendChild(titleInput);

    titleError = document.createElement("div");
    titleError.style.cssText =
      "font-size:10px;color:var(--error);margin-bottom:12px;min-height:12px;";
    form.appendChild(titleError);

    const timeLabel = document.createElement("label");
    timeLabel.style.cssText =
      "display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;";
    timeLabel.textContent = "Date & Time";
    form.appendChild(timeLabel);

    timeInput = document.createElement("input");
    timeInput.type = "datetime-local";
    // A minute out keeps a same-instant submit from failing the
    // targetTime > now check purely from the seconds truncated by the
    // datetime-local control's minute granularity.
    timeInput.value = epochToDatetimeLocal(Date.now() + 60_000);
    timeInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;margin-bottom:4px;";
    timeInput.addEventListener("input", () => {
      if (timeError) timeError.textContent = "";
    });
    form.appendChild(timeInput);

    timeError = document.createElement("div");
    timeError.style.cssText =
      "font-size:10px;color:var(--error);margin-bottom:12px;min-height:12px;";
    form.appendChild(timeError);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Add Reminder";
    saveBtn.style.cssText =
      "flex:1;padding:10px 0;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-family:var(--font);text-transform:uppercase;letter-spacing:1px;cursor:pointer;";
    saveBtn.addEventListener("click", () => {
      void handleEditorSave();
    });
    btnRow.appendChild(saveBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "flex:1;padding:10px 0;border:1px solid var(--border);background:transparent;color:var(--text-dim);font-size:11px;font-family:var(--font);text-transform:uppercase;letter-spacing:1px;cursor:pointer;";
    cancelBtn.addEventListener("click", () => closeEditor());
    btnRow.appendChild(cancelBtn);

    form.appendChild(btnRow);
    editorContainer.appendChild(form);
  }

  /** Persists the given Reminders array; only applies it locally on success. */
  async function persistReminders(next: Reminder[]): Promise<boolean> {
    const result = await saveConfig<RemindersStore>(
      bridge,
      STORAGE_KEYS.REMINDERS,
      { reminders: next },
    );

    if (result.success) {
      reminders = next;
      clearError();
      return true;
    }

    showError(
      "Could not sync to glasses. Your changes were not saved — please try again.",
    );
    return false;
  }

  async function handleEditorSave(): Promise<void> {
    if (!titleInput || !timeInput) return;

    if (!canAddReminder(reminders)) {
      closeEditor();
      return;
    }

    const title = titleInput.value.trim();
    const targetTime = datetimeLocalToEpoch(timeInput.value);
    const now = Date.now();

    if (title.length < 1 || title.length > REMINDER_TITLE_MAX_LENGTH) {
      if (titleError) {
        titleError.textContent = `Title must be 1–${REMINDER_TITLE_MAX_LENGTH} characters.`;
      }
      return;
    }

    if (!Number.isFinite(targetTime) || targetTime <= now) {
      if (timeError) {
        timeError.textContent = "Pick a date and time in the future.";
      }
      return;
    }

    if (!validateReminder(title, targetTime, now)) {
      if (timeError) {
        timeError.textContent = "That reminder isn't valid.";
      }
      return;
    }

    const newReminder: Reminder = {
      id: crypto.randomUUID(),
      title,
      targetTime,
      completed: false,
    };

    const success = await persistReminders([...reminders, newReminder]);
    if (success) {
      closeEditor();
      refreshList();
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const next = deleteReminder(reminders, id);
    await persistReminders(next);
    refreshList();
  }

  // ── Load / render ──

  async function loadState(): Promise<void> {
    const store = await loadConfig<RemindersStore>(
      bridge,
      STORAGE_KEYS.REMINDERS,
      emptyRemindersStore(),
    );
    reminders = Array.isArray(store?.reminders) ? store.reminders : [];

    const clockConfig = await loadConfig<ClockConfig>(
      bridge,
      STORAGE_KEYS.CLOCK_CONFIG,
      DEFAULT_CLOCK_CONFIG,
    );
    clockFormat = clockConfig?.format ?? DEFAULT_CLOCK_CONFIG.format;

    refreshList();
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "app-config-container";

    const backBtn = document.createElement("button");
    backBtn.className = "app-config-back-btn";
    backBtn.textContent = "← Apps";
    backBtn.addEventListener("click", onBack);
    wrapper.appendChild(backBtn);

    const header = document.createElement("div");
    header.className = "app-config-header";
    const title = document.createElement("h2");
    title.className = "app-config-title";
    title.textContent = "Reminders";
    header.appendChild(title);
    const desc = document.createElement("p");
    desc.className = "app-config-description";
    desc.textContent =
      "Add reminders with a title and a time. Mark them complete from the Reminders screen on your glasses — tap to complete, tap again within 5 seconds to undo.";
    header.appendChild(desc);
    wrapper.appendChild(header);

    errorEl = document.createElement("div");
    errorEl.setAttribute("role", "alert");
    errorEl.style.cssText = "font-size:11px;color:var(--error);margin-bottom:8px;";
    wrapper.appendChild(errorEl);

    listContainer = document.createElement("div");
    listContainer.className = "tasks-reminder-list";
    wrapper.appendChild(listContainer);

    editorContainer = document.createElement("div");
    editorContainer.className = "tasks-reminder-editor-container";
    wrapper.appendChild(editorContainer);

    return wrapper;
  }

  function dispose(): void {
    listContainer = null;
    editorContainer = null;
    errorEl = null;
    titleInput = null;
    titleError = null;
    timeInput = null;
    timeError = null;
    editorOpen = false;
  }

  return {
    id: "tasks-config",
    label: "Reminders",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      void loadState();
    },

    unmount(): void {
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      dispose();
      rootEl = null;
      container = null;
    },
  };
}
