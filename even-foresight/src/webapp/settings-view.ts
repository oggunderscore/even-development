// Feature: foresight-webapp-ui
// SettingsView — combines HUD Layout Editor and HUD Display Mode
// settings into a single settings page view route.

import type { ViewRoute } from "./types";
import { createHudLayoutEditor } from "./hud-layout-editor";
import { createHudDurationControl } from "./hud-duration-control";

export interface SettingsViewOptions {
  bridge: any | null;
}

/**
 * Creates the Settings view route.
 *
 * Mounts two sub-components:
 * 1. HUD Layout Editor — 2×5 grid for placing widgets on the glasses HUD
 * 2. HUD Duration Control — mode toggle and duration for hidden mode
 */
export function createSettingsView(options: SettingsViewOptions): ViewRoute {
  const { bridge } = options;

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;

  const layoutEditor = createHudLayoutEditor({ bridge });
  const durationControl = createHudDurationControl({ bridge });

  function createSection(title: string, className: string): HTMLElement {
    const section = document.createElement("section");
    section.className = `settings-view-section ${className}`;

    const heading = document.createElement("h2");
    heading.className = "settings-view-section-title";
    heading.textContent = title;
    section.appendChild(heading);

    const content = document.createElement("div");
    content.className = "settings-view-section-content";
    section.appendChild(content);

    return section;
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "settings-view-container";

    // HUD Layout section
    const layoutSection = createSection(
      "HUD Layout",
      "settings-view-section--layout",
    );
    wrapper.appendChild(layoutSection);

    const layoutContent = layoutSection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    layoutEditor.mount(layoutContent);

    // Display Mode section
    const displaySection = createSection(
      "HUD Display Mode",
      "settings-view-section--display",
    );
    wrapper.appendChild(displaySection);

    const displayContent = displaySection.querySelector(
      ".settings-view-section-content",
    ) as HTMLElement;

    durationControl.mount(displayContent);

    return wrapper;
  }

  return {
    id: "settings",
    label: "Settings",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
    },

    unmount(): void {
      layoutEditor.unmount();
      durationControl.unmount();

      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
