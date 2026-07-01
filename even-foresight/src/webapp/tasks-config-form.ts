// Feature: foresight-webapp-ui
// TasksConfigForm — task/reminder management config.
// Accessible from the Apps list when tapping Tasks.

import type { ViewRoute } from "./types";

export interface TasksConfigFormOptions {
  bridge: any | null;
  onBack: () => void;
}

export function createTasksConfigForm(
  options: TasksConfigFormOptions,
): ViewRoute {
  const { onBack } = options;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "app-config-container";

    // Back button
    const backBtn = document.createElement("button");
    backBtn.className = "app-config-back-btn";
    backBtn.textContent = "← Apps";
    backBtn.addEventListener("click", onBack);
    wrapper.appendChild(backBtn);

    // App header
    const header = document.createElement("div");
    header.className = "app-config-header";
    const title = document.createElement("h2");
    title.className = "app-config-title";
    title.textContent = "Tasks";
    header.appendChild(title);
    const desc = document.createElement("p");
    desc.className = "app-config-description";
    desc.textContent =
      "Task and reminder management for quick reference on the HUD.";
    header.appendChild(desc);
    wrapper.appendChild(header);

    // Coming soon
    const info = document.createElement("div");
    info.className = "app-config-info";
    info.textContent =
      "Task management configuration coming soon. Reminders will be manageable from this screen in a future update.";
    wrapper.appendChild(info);

    return wrapper;
  }

  return {
    id: "tasks-config",
    label: "Tasks",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
    },

    unmount(): void {
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
