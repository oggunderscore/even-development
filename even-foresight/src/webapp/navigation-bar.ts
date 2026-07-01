// Feature: foresight-webapp-ui
// NavigationBar — horizontal tab bar for post-auth section navigation.
// Renders tabs (Apps, Assistant, Settings, Debug) with active/inactive styling.
// Hidden when unauthenticated; defaults to "Apps" on successful auth.

import type { NavTab } from "./types";

export interface NavigationBar {
  init(
    container: HTMLElement,
    tabs: NavTab[],
    onTabChange: (id: string) => void,
  ): void;
  setActive(id: string): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

/**
 * Creates a NavigationBar component that renders tab buttons in a horizontal layout.
 * Active tab uses green accent color (--accent) + bottom border.
 * Inactive tabs use dim text color (--text-dim) with no bottom border.
 * All tabs use JetBrains Mono font on a dark background (--bg).
 */
export function createNavigationBar(): NavigationBar {
  let navElement: HTMLElement | null = null;
  let tabElements: Map<string, HTMLElement> = new Map();
  let activeTabId = "";
  let tabChangeCallback: ((id: string) => void) | null = null;

  function applyTabStyle(tabEl: HTMLElement, isActive: boolean): void {
    tabEl.style.padding = "8px 16px";
    tabEl.style.cursor = "pointer";
    tabEl.style.border = "none";
    tabEl.style.borderBottom = isActive
      ? "2px solid var(--accent)"
      : "2px solid transparent";
    tabEl.style.background = "transparent";
    tabEl.style.fontFamily = "'JetBrains Mono', monospace";
    tabEl.style.fontSize = "14px";
    tabEl.style.color = isActive ? "var(--accent)" : "var(--text-dim)";
    tabEl.style.transition = "color 0.2s, border-color 0.2s";
    tabEl.setAttribute("aria-selected", String(isActive));
  }

  function setActive(id: string): void {
    if (!tabElements.has(id)) {
      console.warn(`[NavigationBar] Unknown tab id: "${id}"`);
      return;
    }

    activeTabId = id;

    // Update styling on all tabs
    for (const [tabId, tabEl] of tabElements) {
      applyTabStyle(tabEl, tabId === id);
    }
  }

  const navigationBar: NavigationBar = {
    init(
      container: HTMLElement,
      tabs: NavTab[],
      onTabChange: (id: string) => void,
    ): void {
      tabChangeCallback = onTabChange;

      // Create nav container
      navElement = document.createElement("nav");
      navElement.className = "nav-bar";
      navElement.setAttribute("role", "tablist");
      navElement.style.display = "none"; // Hidden by default (unauthenticated)
      navElement.style.flexDirection = "row";
      navElement.style.alignItems = "center";
      navElement.style.gap = "0";
      navElement.style.background = "var(--bg)";
      navElement.style.fontFamily = "'JetBrains Mono', monospace";
      navElement.style.borderBottom = "1px solid var(--text-dim)";

      // Create tab buttons
      for (const tab of tabs) {
        const tabEl = document.createElement("button");
        tabEl.className = "nav-bar-tab";
        tabEl.setAttribute("role", "tab");
        tabEl.setAttribute("data-tab-id", tab.id);
        tabEl.textContent = tab.label;
        applyTabStyle(tabEl, false);

        tabEl.addEventListener("click", () => {
          if (tab.id !== activeTabId) {
            setActive(tab.id);
            tabChangeCallback?.(tab.id);
          }
        });

        tabElements.set(tab.id, tabEl);
        navElement.appendChild(tabEl);
      }

      container.appendChild(navElement);
    },

    setActive,

    show(): void {
      if (navElement) {
        navElement.style.display = "flex";
      }
    },

    hide(): void {
      if (navElement) {
        navElement.style.display = "none";
      }
    },

    dispose(): void {
      if (navElement && navElement.parentElement) {
        navElement.parentElement.removeChild(navElement);
      }
      navElement = null;
      tabElements.clear();
      activeTabId = "";
      tabChangeCallback = null;
    },
  };

  return navigationBar;
}
