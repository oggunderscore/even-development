// Feature: foresight-webapp-ui
// MarketplaceView — browsable marketplace page with category sidebar and app grid.
// Displays community-submitted apps filtered by category, or "No Apps Available" when empty.

import type { ViewRoute, MarketplaceApp, MarketplaceCategory } from "./types";

/** All marketplace categories in display order. */
const CATEGORIES: { id: MarketplaceCategory; label: string }[] = [
  { id: "productivity", label: "Productivity" },
  { id: "social", label: "Social" },
  { id: "health", label: "Health" },
  { id: "entertainment", label: "Entertainment" },
  { id: "utilities", label: "Utilities" },
];

/**
 * Filters a list of marketplace apps by category.
 * Returns only apps whose `category` field matches the given category.
 * Exported for property-based testing.
 */
export function filterByCategory(
  apps: MarketplaceApp[],
  category: MarketplaceCategory,
): MarketplaceApp[] {
  return apps.filter((app) => app.category === category);
}

export interface MarketplaceViewOptions {
  apps: MarketplaceApp[];
  onBack: () => void;
}

/**
 * Creates the MarketplaceView as a ViewRoute.
 * Renders a category sidebar on the left and an app grid on the right.
 * Filters apps by the selected category; shows "No Apps Available" when empty.
 * Includes a back button to return to the Apps tab.
 */
export function createMarketplaceView(
  options: MarketplaceViewOptions,
): ViewRoute {
  const { apps, onBack } = options;
  let container: HTMLElement | null = null;
  let selectedCategory: MarketplaceCategory = "productivity";

  function render(): void {
    if (!container) return;
    container.innerHTML = "";

    // Wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "marketplace-wrapper";

    // Header with back button
    const header = document.createElement("div");
    header.className = "marketplace-header";

    const backBtn = document.createElement("button");
    backBtn.className = "marketplace-back-btn";
    backBtn.textContent = "← Back to Apps";
    backBtn.addEventListener("click", onBack);
    header.appendChild(backBtn);

    wrapper.appendChild(header);

    // Content area: sidebar + grid
    const content = document.createElement("div");
    content.className = "marketplace-content";

    // Category sidebar
    const sidebar = document.createElement("nav");
    sidebar.className = "marketplace-sidebar";

    for (const cat of CATEGORIES) {
      const catBtn = document.createElement("button");
      catBtn.className = "marketplace-category-btn";
      if (cat.id === selectedCategory) {
        catBtn.classList.add("marketplace-category-btn--active");
      }
      catBtn.textContent = cat.label;
      catBtn.dataset.category = cat.id;
      catBtn.addEventListener("click", () => {
        selectedCategory = cat.id;
        render();
      });
      sidebar.appendChild(catBtn);
    }

    content.appendChild(sidebar);

    // App grid area
    const grid = document.createElement("div");
    grid.className = "marketplace-grid";

    const filteredApps = filterByCategory(apps, selectedCategory);

    if (filteredApps.length === 0) {
      const emptyMsg = document.createElement("p");
      emptyMsg.className = "marketplace-empty";
      emptyMsg.textContent = "No Apps Available";
      grid.appendChild(emptyMsg);
    } else {
      for (const app of filteredApps) {
        const card = document.createElement("div");
        card.className = "marketplace-app-card";

        const appName = document.createElement("h3");
        appName.className = "marketplace-app-name";
        appName.textContent = app.name;
        card.appendChild(appName);

        const appAuthor = document.createElement("span");
        appAuthor.className = "marketplace-app-author";
        appAuthor.textContent = `by ${app.author}`;
        card.appendChild(appAuthor);

        const appDesc = document.createElement("p");
        appDesc.className = "marketplace-app-description";
        appDesc.textContent = app.description;
        card.appendChild(appDesc);

        grid.appendChild(card);
      }
    }

    content.appendChild(grid);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
  }

  return {
    id: "marketplace",
    label: "Marketplace",

    mount(el: HTMLElement): void {
      container = el;
      selectedCategory = "productivity";
      render();
    },

    unmount(): void {
      if (container) {
        container.innerHTML = "";
      }
      container = null;
    },
  };
}
