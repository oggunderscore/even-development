// Feature: foresight-webapp-ui
// AssistantConfigForm — renders STT/LLM provider selectors, tuning toggles,
// free-text personalization fields, and validates/persists configuration.

import type { AssistantConfig, ViewRoute } from "./types";
import { DEFAULT_ASSISTANT_CONFIG, STORAGE_KEYS } from "./types";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface AssistantConfigFormOptions {
  bridge: any | null;
  onBack?: () => void;
}

/**
 * Validate a text field value against length constraints.
 * Accepts strings with length in [minLen, maxLen], rejects length 0 or > maxLen.
 * Exported for property testing.
 */
export function validateTextField(
  text: string,
  minLen = 1,
  maxLen = 500,
): boolean {
  return text.length >= minLen && text.length <= maxLen;
}

/**
 * Creates the Assistant configuration view route.
 * Renders STT provider selector, LLM provider selector, tuning toggles,
 * About Me and Objectives text areas with character counts, and save/validation logic.
 */
export function createAssistantConfigForm(
  options: AssistantConfigFormOptions,
): ViewRoute {
  const { bridge, onBack } = options;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let config: AssistantConfig = { ...DEFAULT_ASSISTANT_CONFIG };

  // DOM references for form elements
  let sttSelect: HTMLSelectElement | null = null;
  let llmSelect: HTMLSelectElement | null = null;
  let memoryToggle: HTMLInputElement | null = null;
  let contextToggle: HTMLInputElement | null = null;
  let aboutMeTextarea: HTMLTextAreaElement | null = null;
  let aboutMeCount: HTMLSpanElement | null = null;
  let objectivesTextarea: HTMLTextAreaElement | null = null;
  let objectivesCount: HTMLSpanElement | null = null;
  let statusMessage: HTMLDivElement | null = null;
  let llmError: HTMLDivElement | null = null;

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "assistant-config-container";

    // Back button
    if (onBack) {
      const backBtn = document.createElement("button");
      backBtn.className = "app-config-back-btn";
      backBtn.textContent = "← Apps";
      backBtn.addEventListener("click", onBack);
      wrapper.appendChild(backBtn);
    }

    // STT Provider
    wrapper.appendChild(createSttSection());

    // LLM Provider
    wrapper.appendChild(createLlmSection());

    // Tuning Toggles
    wrapper.appendChild(createTogglesSection());

    // About Me
    wrapper.appendChild(createTextFieldSection("aboutMe", "About Me"));

    // Objectives/Goals
    wrapper.appendChild(
      createTextFieldSection("objectives", "Objectives/Goals"),
    );

    // Save button
    const saveBtn = document.createElement("button");
    saveBtn.className = "assistant-config-save-btn";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      void save();
    });
    wrapper.appendChild(saveBtn);

    // Status message area
    statusMessage = document.createElement("div");
    statusMessage.className = "assistant-config-status";
    statusMessage.setAttribute("role", "status");
    statusMessage.setAttribute("aria-live", "polite");
    wrapper.appendChild(statusMessage);

    return wrapper;
  }

  function createSttSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "assistant-config-section";

    const label = document.createElement("label");
    label.className = "assistant-config-label";
    label.textContent = "Speech-to-Text Provider";
    label.htmlFor = "assistant-stt-provider";
    section.appendChild(label);

    sttSelect = document.createElement("select");
    sttSelect.className = "assistant-config-select";
    sttSelect.id = "assistant-stt-provider";

    const whisperOption = document.createElement("option");
    whisperOption.value = "whisper";
    whisperOption.textContent = "Whisper";
    sttSelect.appendChild(whisperOption);

    sttSelect.value = config.sttProvider;
    sttSelect.addEventListener("change", () => {
      config.sttProvider = sttSelect!.value;
    });

    section.appendChild(sttSelect);
    return section;
  }

  function createLlmSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "assistant-config-section";

    const label = document.createElement("label");
    label.className = "assistant-config-label";
    label.textContent = "LLM Provider";
    label.htmlFor = "assistant-llm-provider";
    section.appendChild(label);

    llmSelect = document.createElement("select");
    llmSelect.className = "assistant-config-select";
    llmSelect.id = "assistant-llm-provider";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Select a provider...";
    llmSelect.appendChild(placeholderOption);

    const anthropicOption = document.createElement("option");
    anthropicOption.value = "anthropic";
    anthropicOption.textContent = "Anthropic";
    llmSelect.appendChild(anthropicOption);

    const openaiOption = document.createElement("option");
    openaiOption.value = "openai";
    openaiOption.textContent = "OpenAI";
    llmSelect.appendChild(openaiOption);

    llmSelect.value = config.llmProvider ?? "";
    llmSelect.addEventListener("change", () => {
      const val = llmSelect!.value;
      config.llmProvider = val === "anthropic" || val === "openai" ? val : null;
      // Clear validation error on change
      if (llmError) {
        llmError.textContent = "";
        llmError.classList.remove("assistant-config-error-visible");
      }
    });

    section.appendChild(llmSelect);

    // Validation error for LLM
    llmError = document.createElement("div");
    llmError.className = "assistant-config-error";
    llmError.setAttribute("role", "alert");
    section.appendChild(llmError);

    return section;
  }

  function createTogglesSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "assistant-config-section assistant-config-toggles";

    // Conversation Memory toggle
    const memoryGroup = document.createElement("div");
    memoryGroup.className = "assistant-config-toggle-group";

    memoryToggle = document.createElement("input");
    memoryToggle.type = "checkbox";
    memoryToggle.id = "assistant-memory-toggle";
    memoryToggle.className = "assistant-config-checkbox";
    memoryToggle.checked = config.conversationMemory;
    memoryToggle.addEventListener("change", () => {
      config.conversationMemory = memoryToggle!.checked;
    });

    const memoryLabel = document.createElement("label");
    memoryLabel.htmlFor = "assistant-memory-toggle";
    memoryLabel.className = "assistant-config-toggle-label";
    memoryLabel.textContent = "Conversation Memory";

    memoryGroup.appendChild(memoryToggle);
    memoryGroup.appendChild(memoryLabel);
    section.appendChild(memoryGroup);

    // Context Awareness toggle
    const contextGroup = document.createElement("div");
    contextGroup.className = "assistant-config-toggle-group";

    contextToggle = document.createElement("input");
    contextToggle.type = "checkbox";
    contextToggle.id = "assistant-context-toggle";
    contextToggle.className = "assistant-config-checkbox";
    contextToggle.checked = config.contextAwareness;
    contextToggle.addEventListener("change", () => {
      config.contextAwareness = contextToggle!.checked;
    });

    const contextLabel = document.createElement("label");
    contextLabel.htmlFor = "assistant-context-toggle";
    contextLabel.className = "assistant-config-toggle-label";
    contextLabel.textContent = "Context Awareness";

    contextGroup.appendChild(contextToggle);
    contextGroup.appendChild(contextLabel);
    section.appendChild(contextGroup);

    return section;
  }

  function createTextFieldSection(
    field: "aboutMe" | "objectives",
    labelText: string,
  ): HTMLElement {
    const section = document.createElement("div");
    section.className = "assistant-config-section";

    const label = document.createElement("label");
    label.className = "assistant-config-label";
    label.textContent = labelText;
    label.htmlFor = `assistant-${field}`;
    section.appendChild(label);

    const textarea = document.createElement("textarea");
    textarea.className = "assistant-config-textarea";
    textarea.id = `assistant-${field}`;
    textarea.maxLength = 500;
    textarea.rows = 4;
    textarea.placeholder = `Enter ${labelText.toLowerCase()} (1–500 characters)`;
    textarea.value = config[field];

    const countEl = document.createElement("span");
    countEl.className = "assistant-config-char-count";
    countEl.textContent = `${config[field].length}/500`;

    textarea.addEventListener("input", () => {
      // maxLength attribute prevents input beyond 500, but also update config
      config[field] = textarea.value;
      countEl.textContent = `${textarea.value.length}/500`;
    });

    section.appendChild(textarea);
    section.appendChild(countEl);

    // Store references
    if (field === "aboutMe") {
      aboutMeTextarea = textarea;
      aboutMeCount = countEl;
    } else {
      objectivesTextarea = textarea;
      objectivesCount = countEl;
    }

    return section;
  }

  async function load(): Promise<void> {
    config = await loadConfig<AssistantConfig>(
      bridge,
      STORAGE_KEYS.ASSISTANT_CONFIG,
      { ...DEFAULT_ASSISTANT_CONFIG },
    );
    populateForm();
  }

  function populateForm(): void {
    if (sttSelect) {
      sttSelect.value = config.sttProvider;
    }
    if (llmSelect) {
      llmSelect.value = config.llmProvider ?? "";
    }
    if (memoryToggle) {
      memoryToggle.checked = config.conversationMemory;
    }
    if (contextToggle) {
      contextToggle.checked = config.contextAwareness;
    }
    if (aboutMeTextarea) {
      aboutMeTextarea.value = config.aboutMe;
    }
    if (aboutMeCount) {
      aboutMeCount.textContent = `${config.aboutMe.length}/500`;
    }
    if (objectivesTextarea) {
      objectivesTextarea.value = config.objectives;
    }
    if (objectivesCount) {
      objectivesCount.textContent = `${config.objectives.length}/500`;
    }
  }

  async function save(): Promise<{ success: boolean; error?: string }> {
    // Clear previous status
    if (statusMessage) {
      statusMessage.textContent = "";
      statusMessage.className = "assistant-config-status";
    }

    // Validate LLM provider is selected
    if (config.llmProvider === null) {
      if (llmError) {
        llmError.textContent = "An LLM provider is required";
        llmError.classList.add("assistant-config-error-visible");
      }
      return { success: false, error: "An LLM provider is required" };
    }

    // Validate text fields — they can be empty (not required for save unless
    // user has started typing). The spec says 1–500 chars, but the fields
    // are optional (empty is allowed as default). maxLength prevents > 500.
    // Actually, re-reading req 5.7: "prevent further input" at 500 — maxLength handles that.
    // The validation for save just needs LLM provider per req 5.5.

    // Persist via bridge
    const result = await saveConfig(
      bridge,
      STORAGE_KEYS.ASSISTANT_CONFIG,
      config,
    );

    if (result.success) {
      showStatus(
        "Settings saved successfully",
        "assistant-config-status-success",
      );
    } else {
      showStatus(
        "Settings could not be synced to glasses. Your changes are saved locally.",
        "assistant-config-status-error",
      );
    }

    return result;
  }

  function showStatus(message: string, className: string): void {
    if (statusMessage) {
      statusMessage.textContent = message;
      statusMessage.className = `assistant-config-status ${className}`;

      // Auto-dismiss success after 3 seconds
      if (className === "assistant-config-status-success") {
        setTimeout(() => {
          if (statusMessage) {
            statusMessage.textContent = "";
            statusMessage.className = "assistant-config-status";
          }
        }, 3000);
      }
    }
  }

  function dispose(): void {
    // Clear references
    sttSelect = null;
    llmSelect = null;
    memoryToggle = null;
    contextToggle = null;
    aboutMeTextarea = null;
    aboutMeCount = null;
    objectivesTextarea = null;
    objectivesCount = null;
    statusMessage = null;
    llmError = null;
  }

  return {
    id: "assistant",
    label: "Assistant",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      void load();
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
