// Feature: smarter-everyday
// SmarterEverydayConfigForm — renders the Topic list (add/edit/delete),
// per-Topic interval + Quiet_Hours controls, and the SmarterEveryday
// Notification_History retention / popup duration settings. Follows the
// same ViewRoute/mount-unmount/loadConfig/saveConfig structure as
// weather-config-form.ts and assistant-config-form.ts.

import type { ViewRoute } from "./types";
import type {
  QuietHoursConfig,
  SmarterEverydaySettings,
  SmarterEverydayTopicsStore,
  Topic,
} from "../storage/schemas";
import {
  DEFAULT_QUIET_HOURS,
  DEFAULT_SMARTER_EVERYDAY_SETTINGS,
  DEFAULT_SMARTER_EVERYDAY_TOPICS,
  STORAGE_KEYS,
} from "../storage/schemas";
import {
  addTopic,
  clampToRange,
  editTopic,
  isValidTopicDescription,
  removeTopic,
  TopicValidationError,
  INTERVAL_CUSTOM_MAX,
  INTERVAL_CUSTOM_MIN,
  INTERVAL_DEFAULT_MIN,
  INTERVAL_PRESETS_MIN,
  TOPIC_DESCRIPTION_MAX,
} from "../smarter-everyday/topic-manager";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface SmarterEverydayConfigFormOptions {
  bridge: any | null;
  onBack?: () => void;
}

// SmarterEverydaySettings bounds (Requirement 11.3). Not exported from
// topic-manager.ts (that module only owns the Topic-related bounds), so
// they're declared here for the form's clamping.
const HISTORY_RETENTION_MIN = 1;
const HISTORY_RETENTION_MAX = 20;
const POPUP_DURATION_MIN = 10;
const POPUP_DURATION_MAX = 120;

/**
 * Converts a 0–1439 minute-of-day value to an "HH:MM" string for a
 * `<input type="time">`. Exported for property testing.
 */
export function minutesToTimeString(minutes: number): string {
  const clamped = clampToRange(Math.round(minutes), 0, 1439);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parses an "HH:MM" string (as produced by `<input type="time">`) into a
 * 0–1439 minute-of-day value. Falls back to 0 for unparseable input.
 * Exported for property testing.
 */
export function timeStringToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return 0;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return clampToRange(h * 60 + m, 0, 1439);
}

/**
 * Formats a Topic's Quiet_Hours for display in the Topic list.
 * Exported for property testing.
 */
export function formatQuietHoursStatus(quietHours: QuietHoursConfig): string {
  if (!quietHours.enabled) return "Quiet Hours Off";
  return `Quiet ${minutesToTimeString(quietHours.startMinuteOfDay)}–${minutesToTimeString(quietHours.endMinuteOfDay)}`;
}

type EditorTarget = { kind: "new" } | { kind: "edit"; id: string };

/**
 * Creates the SmarterEveryday configuration view route.
 * Renders the Topic list with add/edit/delete controls, interval preset
 * buttons + custom numeric input (clamped via `clampToRange`), Quiet_Hours
 * start/end inputs, and the Notification_History retention / popup
 * duration settings fields.
 */
export function createSmarterEverydayConfigForm(
  options: SmarterEverydayConfigFormOptions,
): ViewRoute {
  const { bridge, onBack } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  let topics: Topic[] = [...DEFAULT_SMARTER_EVERYDAY_TOPICS.topics];
  let settings: SmarterEverydaySettings = {
    ...DEFAULT_SMARTER_EVERYDAY_SETTINGS,
  };

  let editorTarget: EditorTarget | null = null;
  let editorIntervalValue = INTERVAL_DEFAULT_MIN;

  // Persistent DOM containers, re-rendered in place rather than the whole form.
  let topicListContainer: HTMLElement | null = null;
  let editorContainer: HTMLElement | null = null;
  let errorEl: HTMLElement | null = null;

  // Settings field references.
  let historyInput: HTMLInputElement | null = null;
  let durationInput: HTMLInputElement | null = null;

  // Editor field references.
  let editorDescriptionInput: HTMLInputElement | null = null;
  let editorDescriptionError: HTMLElement | null = null;
  let editorCustomIntervalInput: HTMLInputElement | null = null;
  let editorQuietToggle: HTMLInputElement | null = null;
  let editorQuietStartInput: HTMLInputElement | null = null;
  let editorQuietEndInput: HTMLInputElement | null = null;
  const editorPresetButtons = new Map<number, HTMLButtonElement>();

  function clearError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.classList.remove("smarter-everyday-config-error--visible");
    }
  }

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add("smarter-everyday-config-error--visible");
    }
  }

  // ── Topic list ──

  function renderTopicRow(topic: Topic): HTMLElement {
    const row = document.createElement("div");
    row.className = "smarter-everyday-topic-row";
    row.dataset.topicId = topic.id;
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const descEl = document.createElement("div");
    descEl.style.cssText =
      "font-size:12px;color:var(--text);margin-bottom:4px;word-break:break-word;";
    descEl.textContent = topic.description;
    info.appendChild(descEl);

    const metaEl = document.createElement("div");
    metaEl.style.cssText = "font-size:10px;color:var(--text-dim);";
    metaEl.textContent = `Every ${topic.notificationIntervalMinutes} min \u00b7 ${formatQuietHoursStatus(topic.quietHours)}`;
    info.appendChild(metaEl);

    row.appendChild(info);

    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:8px;flex-shrink:0;";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "smarter-everyday-topic-btn";
    editBtn.style.cssText =
      "padding:6px 10px;border:1px solid var(--accent-dim);background:transparent;color:var(--accent);font-size:10px;font-family:var(--font);text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      openEditor({ kind: "edit", id: topic.id });
    });
    controls.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "smarter-everyday-topic-btn";
    deleteBtn.style.cssText =
      "padding:6px 10px;border:1px solid var(--error);background:transparent;color:var(--error);font-size:10px;font-family:var(--font);text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      void handleDelete(topic.id);
    });
    controls.appendChild(deleteBtn);

    row.appendChild(controls);
    return row;
  }

  function refreshTopicList(): void {
    if (!topicListContainer) return;
    topicListContainer.innerHTML = "";

    if (topics.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText =
        "font-size:11px;color:var(--text-dim);font-style:italic;padding:8px 0;";
      empty.textContent = "No topics yet.";
      topicListContainer.appendChild(empty);
    } else {
      for (const topic of topics) {
        topicListContainer.appendChild(renderTopicRow(topic));
      }
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "smarter-everyday-add-topic-btn";
    addBtn.style.cssText =
      "width:100%;margin-top:12px;padding:10px 0;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-family:var(--font);text-transform:uppercase;letter-spacing:1px;cursor:pointer;";
    addBtn.textContent = "+ Add Topic";
    addBtn.disabled = topics.length >= 5;
    addBtn.addEventListener("click", () => {
      openEditor({ kind: "new" });
    });
    topicListContainer.appendChild(addBtn);
  }

  // ── Topic editor (add/edit) ──

  function updatePresetHighlight(): void {
    for (const [preset, btn] of editorPresetButtons) {
      const active = preset === editorIntervalValue;
      btn.style.borderColor = active ? "var(--accent)" : "var(--border)";
      btn.style.color = active ? "var(--accent)" : "var(--text)";
    }
  }

  function openEditor(target: EditorTarget): void {
    editorTarget = target;
    clearError();
    renderEditor();
  }

  function closeEditor(): void {
    editorTarget = null;
    if (editorContainer) {
      editorContainer.innerHTML = "";
    }
  }

  function renderEditor(): void {
    if (!editorContainer || !editorTarget) return;
    editorContainer.innerHTML = "";
    editorPresetButtons.clear();

    const target = editorTarget;
    const topic =
      target.kind === "edit"
        ? (topics.find((t) => t.id === target.id) ?? null)
        : null;
    const initialDescription = topic?.description ?? "";
    const initialInterval =
      topic?.notificationIntervalMinutes ?? INTERVAL_DEFAULT_MIN;
    const initialQuietHours = topic?.quietHours ?? DEFAULT_QUIET_HOURS;

    editorIntervalValue = clampToRange(
      initialInterval,
      INTERVAL_CUSTOM_MIN,
      INTERVAL_CUSTOM_MAX,
    );

    const form = document.createElement("div");
    form.className = "smarter-everyday-topic-editor";
    form.style.cssText =
      "border:1px solid var(--border);padding:12px;margin:12px 0;background:var(--surface);";

    const titleEl = document.createElement("h4");
    titleEl.style.cssText =
      "font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;";
    titleEl.textContent =
      editorTarget.kind === "new" ? "New Topic" : "Edit Topic";
    form.appendChild(titleEl);

    // Description
    const descLabel = document.createElement("label");
    descLabel.style.cssText =
      "display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;";
    descLabel.textContent = "Description";
    form.appendChild(descLabel);

    editorDescriptionInput = document.createElement("input");
    editorDescriptionInput.type = "text";
    editorDescriptionInput.maxLength = TOPIC_DESCRIPTION_MAX;
    editorDescriptionInput.value = initialDescription;
    editorDescriptionInput.placeholder = "e.g. Japanese N4 kanji";
    editorDescriptionInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;margin-bottom:4px;";
    editorDescriptionInput.addEventListener("input", () => {
      if (editorDescriptionError) editorDescriptionError.textContent = "";
    });
    form.appendChild(editorDescriptionInput);

    editorDescriptionError = document.createElement("div");
    editorDescriptionError.style.cssText =
      "font-size:10px;color:var(--error);margin-bottom:12px;min-height:12px;";
    form.appendChild(editorDescriptionError);

    // Interval presets
    const intervalLabel = document.createElement("label");
    intervalLabel.style.cssText =
      "display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px;";
    intervalLabel.textContent = "Notification Interval (minutes)";
    form.appendChild(intervalLabel);

    const presetRow = document.createElement("div");
    presetRow.style.cssText = "display:flex;gap:8px;margin-bottom:8px;";
    for (const preset of INTERVAL_PRESETS_MIN) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(preset);
      btn.className = "smarter-everyday-preset-btn";
      btn.style.cssText =
        "flex:1;padding:8px 0;border:1px solid var(--border);background:transparent;color:var(--text);font-size:11px;font-family:var(--font);cursor:pointer;";
      btn.addEventListener("click", () => {
        editorIntervalValue = preset;
        if (editorCustomIntervalInput) {
          editorCustomIntervalInput.value = String(preset);
        }
        updatePresetHighlight();
      });
      presetRow.appendChild(btn);
      editorPresetButtons.set(preset, btn);
    }
    form.appendChild(presetRow);

    const customLabel = document.createElement("label");
    customLabel.style.cssText =
      "display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;";
    customLabel.textContent = `Custom (${INTERVAL_CUSTOM_MIN}\u2013${INTERVAL_CUSTOM_MAX})`;
    form.appendChild(customLabel);

    editorCustomIntervalInput = document.createElement("input");
    editorCustomIntervalInput.type = "number";
    editorCustomIntervalInput.min = String(INTERVAL_CUSTOM_MIN);
    editorCustomIntervalInput.max = String(INTERVAL_CUSTOM_MAX);
    editorCustomIntervalInput.value = String(editorIntervalValue);
    editorCustomIntervalInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;margin-bottom:12px;";
    editorCustomIntervalInput.addEventListener("change", () => {
      const raw = Number(editorCustomIntervalInput!.value);
      editorIntervalValue = clampToRange(
        Number.isFinite(raw) ? raw : INTERVAL_DEFAULT_MIN,
        INTERVAL_CUSTOM_MIN,
        INTERVAL_CUSTOM_MAX,
      );
      editorCustomIntervalInput!.value = String(editorIntervalValue);
      updatePresetHighlight();
    });
    form.appendChild(editorCustomIntervalInput);

    updatePresetHighlight();

    // Quiet hours
    const quietToggleRow = document.createElement("div");
    quietToggleRow.style.cssText =
      "display:flex;align-items:center;gap:8px;margin-bottom:8px;";

    editorQuietToggle = document.createElement("input");
    editorQuietToggle.type = "checkbox";
    editorQuietToggle.checked = initialQuietHours.enabled;

    const quietToggleLabel = document.createElement("label");
    quietToggleLabel.style.cssText = "font-size:11px;color:var(--text);";
    quietToggleLabel.textContent = "Quiet Hours";

    const quietTimesRow = document.createElement("div");
    quietTimesRow.style.cssText = `display:flex;gap:8px;margin-bottom:12px;opacity:${initialQuietHours.enabled ? "1" : "0.4"};`;

    editorQuietToggle.addEventListener("change", () => {
      quietTimesRow.style.opacity = editorQuietToggle!.checked ? "1" : "0.4";
    });

    quietToggleRow.appendChild(editorQuietToggle);
    quietToggleRow.appendChild(quietToggleLabel);
    form.appendChild(quietToggleRow);

    const startGroup = document.createElement("div");
    startGroup.style.cssText = "flex:1;";
    const startLabel = document.createElement("label");
    startLabel.style.cssText =
      "display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;";
    startLabel.textContent = "Start";
    editorQuietStartInput = document.createElement("input");
    editorQuietStartInput.type = "time";
    editorQuietStartInput.value = minutesToTimeString(
      initialQuietHours.startMinuteOfDay,
    );
    editorQuietStartInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;";
    startGroup.appendChild(startLabel);
    startGroup.appendChild(editorQuietStartInput);

    const endGroup = document.createElement("div");
    endGroup.style.cssText = "flex:1;";
    const endLabel = document.createElement("label");
    endLabel.style.cssText =
      "display:block;font-size:10px;color:var(--text-dim);margin-bottom:4px;";
    endLabel.textContent = "End";
    editorQuietEndInput = document.createElement("input");
    editorQuietEndInput.type = "time";
    editorQuietEndInput.value = minutesToTimeString(
      initialQuietHours.endMinuteOfDay,
    );
    editorQuietEndInput.style.cssText =
      "width:100%;padding:8px 10px;background:transparent;border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;";
    endGroup.appendChild(endLabel);
    endGroup.appendChild(editorQuietEndInput);

    quietTimesRow.appendChild(startGroup);
    quietTimesRow.appendChild(endGroup);
    form.appendChild(quietTimesRow);

    // Save / Cancel
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent =
      editorTarget.kind === "new" ? "Add Topic" : "Save Changes";
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
    cancelBtn.addEventListener("click", () => {
      closeEditor();
    });
    btnRow.appendChild(cancelBtn);

    form.appendChild(btnRow);
    editorContainer.appendChild(form);
  }

  /** Persists the given Topics array; only applies it locally on success. */
  async function persistTopics(newTopics: Topic[]): Promise<boolean> {
    const result = await saveConfig<SmarterEverydayTopicsStore>(
      bridge,
      STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
      { topics: newTopics },
    );

    if (result.success) {
      topics = newTopics;
      clearError();
      return true;
    }

    showError(
      "Could not sync to glasses. Your changes were not saved — please try again.",
    );
    return false;
  }

  async function handleEditorSave(): Promise<void> {
    if (!editorDescriptionInput || !editorTarget) return;

    const description = editorDescriptionInput.value;
    if (!isValidTopicDescription(description)) {
      if (editorDescriptionError) {
        editorDescriptionError.textContent =
          "Description must be 1\u2013200 characters.";
      }
      return;
    }

    const notificationIntervalMinutes = clampToRange(
      editorIntervalValue,
      INTERVAL_CUSTOM_MIN,
      INTERVAL_CUSTOM_MAX,
    );

    const quietHours: QuietHoursConfig = {
      enabled: editorQuietToggle?.checked ?? false,
      startMinuteOfDay: editorQuietStartInput
        ? timeStringToMinutes(editorQuietStartInput.value)
        : DEFAULT_QUIET_HOURS.startMinuteOfDay,
      endMinuteOfDay: editorQuietEndInput
        ? timeStringToMinutes(editorQuietEndInput.value)
        : DEFAULT_QUIET_HOURS.endMinuteOfDay,
    };

    let newTopics: Topic[];
    try {
      if (editorTarget.kind === "new") {
        newTopics = addTopic(
          topics,
          { description, notificationIntervalMinutes, quietHours },
          Date.now(),
        );
      } else {
        newTopics = editTopic(topics, editorTarget.id, {
          description,
          notificationIntervalMinutes,
          quietHours,
        });
      }
    } catch (error) {
      if (error instanceof TopicValidationError) {
        if (editorDescriptionError) {
          editorDescriptionError.textContent = error.message;
        }
        return;
      }
      throw error;
    }

    const success = await persistTopics(newTopics);
    if (success) {
      closeEditor();
      refreshTopicList();
    }
    // On failure, persistTopics already surfaced the error; the editor stays
    // open with the user's entered values untouched so they can retry.
  }

  async function handleDelete(id: string): Promise<void> {
    const newTopics = removeTopic(topics, id);
    await persistTopics(newTopics);
    refreshTopicList();
  }

  // ── Settings (Notification_History retention, popup duration) ──

  async function handleSettingsChange(
    field: keyof SmarterEverydaySettings,
    rawValue: number,
    min: number,
    max: number,
    input: HTMLInputElement,
  ): Promise<void> {
    const clamped = clampToRange(
      Number.isFinite(rawValue) ? rawValue : settings[field],
      min,
      max,
    );
    input.value = String(clamped);

    const updated: SmarterEverydaySettings = { ...settings, [field]: clamped };
    const result = await saveConfig<SmarterEverydaySettings>(
      bridge,
      STORAGE_KEYS.SMARTER_EVERYDAY_SETTINGS,
      updated,
    );

    if (result.success) {
      settings = updated;
      clearError();
    } else {
      showError(
        "Could not sync to glasses. Your changes were not saved — please try again.",
      );
    }
  }

  function renderSettingsSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "smarter-everyday-config-section";
    section.style.cssText =
      "margin-top:20px;padding-top:16px;border-top:1px solid var(--border);";

    const title = document.createElement("h3");
    title.style.cssText =
      "font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;";
    title.textContent = "# SmarterEveryday Settings";
    section.appendChild(title);

    const historyRow = document.createElement("div");
    historyRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 0;";
    const historyLabel = document.createElement("span");
    historyLabel.style.cssText = "font-size:12px;color:var(--text);";
    historyLabel.textContent = `Notification History (${HISTORY_RETENTION_MIN}\u2013${HISTORY_RETENTION_MAX})`;
    historyInput = document.createElement("input");
    historyInput.type = "number";
    historyInput.min = String(HISTORY_RETENTION_MIN);
    historyInput.max = String(HISTORY_RETENTION_MAX);
    historyInput.value = String(settings.notificationHistoryMax);
    historyInput.style.cssText =
      "width:70px;padding:8px 10px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:12px;font-family:var(--font);text-align:center;";
    historyInput.addEventListener("change", () => {
      void handleSettingsChange(
        "notificationHistoryMax",
        Number(historyInput!.value),
        HISTORY_RETENTION_MIN,
        HISTORY_RETENTION_MAX,
        historyInput!,
      );
    });
    historyRow.appendChild(historyLabel);
    historyRow.appendChild(historyInput);
    section.appendChild(historyRow);

    const durationRow = document.createElement("div");
    durationRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 0;";
    const durationLabel = document.createElement("span");
    durationLabel.style.cssText = "font-size:12px;color:var(--text);";
    durationLabel.textContent = `Popup Duration (${POPUP_DURATION_MIN}\u2013${POPUP_DURATION_MAX}s)`;
    durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = String(POPUP_DURATION_MIN);
    durationInput.max = String(POPUP_DURATION_MAX);
    durationInput.value = String(settings.popupDisplayDurationSeconds);
    durationInput.style.cssText =
      "width:70px;padding:8px 10px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:12px;font-family:var(--font);text-align:center;";
    durationInput.addEventListener("change", () => {
      void handleSettingsChange(
        "popupDisplayDurationSeconds",
        Number(durationInput!.value),
        POPUP_DURATION_MIN,
        POPUP_DURATION_MAX,
        durationInput!,
      );
    });
    durationRow.appendChild(durationLabel);
    durationRow.appendChild(durationInput);
    section.appendChild(durationRow);

    return section;
  }

  // ── Load / render ──

  async function loadState(): Promise<void> {
    topics = (
      await loadConfig<SmarterEverydayTopicsStore>(
        bridge,
        STORAGE_KEYS.SMARTER_EVERYDAY_TOPICS,
        { ...DEFAULT_SMARTER_EVERYDAY_TOPICS },
      )
    ).topics;
    settings = await loadConfig<SmarterEverydaySettings>(
      bridge,
      STORAGE_KEYS.SMARTER_EVERYDAY_SETTINGS,
      { ...DEFAULT_SMARTER_EVERYDAY_SETTINGS },
    );

    refreshTopicList();
    if (historyInput)
      historyInput.value = String(settings.notificationHistoryMax);
    if (durationInput) {
      durationInput.value = String(settings.popupDisplayDurationSeconds);
    }
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "smarter-everyday-config-container";

    if (onBack) {
      const backBtn = document.createElement("button");
      backBtn.className = "app-config-back-btn";
      backBtn.textContent = "\u2190 Apps";
      backBtn.addEventListener("click", onBack);
      wrapper.appendChild(backBtn);
    }

    const title = document.createElement("h3");
    title.style.cssText =
      "font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;";
    title.textContent = "# Topics";
    wrapper.appendChild(title);

    errorEl = document.createElement("div");
    errorEl.className = "smarter-everyday-config-error";
    errorEl.setAttribute("role", "alert");
    errorEl.style.cssText =
      "font-size:11px;color:var(--error);margin-bottom:8px;";
    wrapper.appendChild(errorEl);

    topicListContainer = document.createElement("div");
    topicListContainer.className = "smarter-everyday-topic-list";
    wrapper.appendChild(topicListContainer);

    editorContainer = document.createElement("div");
    editorContainer.className = "smarter-everyday-topic-editor-container";
    wrapper.appendChild(editorContainer);

    wrapper.appendChild(renderSettingsSection());

    return wrapper;
  }

  function dispose(): void {
    topicListContainer = null;
    editorContainer = null;
    errorEl = null;
    historyInput = null;
    durationInput = null;
    editorDescriptionInput = null;
    editorDescriptionError = null;
    editorCustomIntervalInput = null;
    editorQuietToggle = null;
    editorQuietStartInput = null;
    editorQuietEndInput = null;
    editorPresetButtons.clear();
    editorTarget = null;
  }

  return {
    id: "smarter-everyday-config",
    label: "SmarterEveryday",

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
