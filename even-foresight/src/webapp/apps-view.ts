// Feature: foresight-webapp-ui
// AppsView — renders the app list with sorting, truncation, source labels,
// app selection handling, and marketplace navigation.

import type { AppEntry, ViewRoute } from "./types";

export interface AppsViewOptions {
  apps: AppEntry[];
  onAppSelect: (id: string) => void;
  onBrowseMarketplace: () => void;
}

/**
 * Sort apps alphabetically by name (case-insensitive).
 * Exported for property testing.
 */
export function sortApps(apps: AppEntry[]): AppEntry[] {
  return [...apps].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/**
 * Truncate a description to maxLen characters.
 * If the description exceeds maxLen, it is cut and "..." is appended.
 * Exported for property testing.
 */
export function truncateDescription(desc: string, maxLen = 80): string {
  if (desc.length <= maxLen) {
    return desc;
  }
  return desc.slice(0, maxLen - 3) + "...";
}

/**
 * Map the source field to a human-readable label.
 * Exported for property testing.
 */
export function getSourceLabel(
  source: "pre-installed" | "marketplace",
): string {
  if (source === "pre-installed") {
    return "Pre-installed";
  }
  return "Marketplace";
}

/**
 * Creates the Apps view route.
 * Renders a sorted list of apps with name, truncated description, source label,
 * a "Browse Marketplace" button, and handles app selection.
 */
export function createAppsView(options: AppsViewOptions): ViewRoute {
  const { apps, onAppSelect, onBrowseMarketplace } = options;
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let noConfigEl: HTMLElement | null = null;

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "apps-view-container";

    // Header with marketplace button
    const header = document.createElement("div");
    header.className = "apps-view-header";

    const marketplaceBtn = document.createElement("button");
    marketplaceBtn.className = "apps-view-marketplace-btn";
    marketplaceBtn.textContent = "Browse Marketplace";
    marketplaceBtn.addEventListener("click", () => {
      onBrowseMarketplace();
    });
    header.appendChild(marketplaceBtn);

    wrapper.appendChild(header);

    // App list
    const list = document.createElement("ul");
    list.className = "apps-view-list";

    const sorted = sortApps(apps);
    for (const app of sorted) {
      const item = document.createElement("li");
      item.className = "apps-view-item";
      item.dataset.appId = app.id;

      const info = document.createElement("div");
      info.className = "apps-view-item-info";

      const nameEl = document.createElement("span");
      nameEl.className = "apps-view-item-name";
      nameEl.textContent = app.name;
      info.appendChild(nameEl);

      const descEl = document.createElement("span");
      descEl.className = "apps-view-item-description";
      descEl.textContent = truncateDescription(app.description);
      info.appendChild(descEl);

      item.appendChild(info);

      const sourceEl = document.createElement("span");
      sourceEl.className = "apps-view-item-source";
      sourceEl.textContent = getSourceLabel(app.source);
      item.appendChild(sourceEl);

      item.addEventListener("click", () => {
        if (app.hasConfig) {
          clearNoConfigNotice();
          onAppSelect(app.id);
        } else {
          // Marketplace widgets can ship without settings. Say so instead of
          // navigating to an empty screen.
          showNoConfigNotice(item, app.name);
        }
      });

      list.appendChild(item);
    }

    wrapper.appendChild(list);

    return wrapper;
  }

  function clearNoConfigNotice(): void {
    noConfigEl?.remove();
    noConfigEl = null;
  }

  function showNoConfigNotice(anchor: HTMLElement, appName: string): void {
    clearNoConfigNotice();
    const notice = document.createElement("div");
    notice.className = "apps-view-no-config";
    notice.setAttribute("role", "status");
    notice.textContent = `No configuration options available for ${appName}.`;
    anchor.insertAdjacentElement("afterend", notice);
    noConfigEl = notice;
  }

  return {
    id: "apps",
    label: "Apps",

    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
    },

    unmount(): void {
      clearNoConfigNotice();
      if (rootEl && container) {
        container.removeChild(rootEl);
      }
      rootEl = null;
      container = null;
    },
  };
}
