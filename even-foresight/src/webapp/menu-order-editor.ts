// MenuOrderEditor — lets the wearer choose the order apps appear in on the
// glasses' double-tap menu. Up/down buttons rather than drag-and-drop, to
// stay consistent with the rest of the phone UI's plain-button controls
// (see `hud-duration-control.ts`, `smarter-everyday-config-form.ts`).

import { applyMenuOrder } from "../menu/menu-order";
import { STORAGE_KEYS, type MenuOrder } from "../storage/schemas";
import { DEFAULT_MENU_ENTRIES, type MenuOrderEntry } from "./types";
import { loadConfig, saveConfig } from "./storage-helpers";

export interface MenuOrderEditorOptions {
  bridge: any | null;
}

export interface MenuOrderEditor {
  mount(container: HTMLElement): void;
  unmount(): void;
}

export function createMenuOrderEditor(
  options: MenuOrderEditorOptions,
): MenuOrderEditor {
  const { bridge } = options;

  let entries: MenuOrderEntry[] = [...DEFAULT_MENU_ENTRIES];

  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let errorEl: HTMLElement | null = null;

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }
  }

  function clearError(): void {
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  async function persist(): Promise<void> {
    const order: MenuOrder = entries.map((e) => e.id);
    const result = await saveConfig<MenuOrder>(
      bridge,
      STORAGE_KEYS.MENU_ORDER,
      order,
    );
    if (result.success) {
      clearError();
    } else {
      showError("Not synced to glasses. Your choice is saved on this phone.");
    }
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;

    const next = [...entries];
    [next[index], next[target]] = [next[target], next[index]];
    entries = next;

    refreshList();
    void persist();
  }

  function renderRow(entry: MenuOrderEntry, index: number): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);";

    const label = document.createElement("span");
    label.style.cssText = "font-size:12px;color:var(--text);flex:1;";
    label.textContent = entry.name;
    row.appendChild(label);

    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:6px;flex-shrink:0;";

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "hud-duration-btn";
    upBtn.textContent = "↑";
    upBtn.setAttribute("aria-label", `Move ${entry.name} up`);
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => move(index, -1));
    controls.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "hud-duration-btn";
    downBtn.textContent = "↓";
    downBtn.setAttribute("aria-label", `Move ${entry.name} down`);
    downBtn.disabled = index === entries.length - 1;
    downBtn.addEventListener("click", () => move(index, 1));
    controls.appendChild(downBtn);

    row.appendChild(controls);
    return row;
  }

  function refreshList(): void {
    if (!listEl) return;
    listEl.innerHTML = "";
    entries.forEach((entry, index) => {
      listEl!.appendChild(renderRow(entry, index));
    });
  }

  function render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "menu-order-editor";

    const description = document.createElement("p");
    description.style.cssText =
      "font-size:11px;color:var(--text-dim);line-height:1.5;margin-bottom:8px;";
    description.textContent =
      "Choose the order apps appear in the glasses menu (double-tap to open).";
    wrapper.appendChild(description);

    errorEl = document.createElement("div");
    errorEl.style.cssText =
      "font-size:10px;color:var(--error);margin-bottom:8px;display:none;";
    wrapper.appendChild(errorEl);

    listEl = document.createElement("div");
    listEl.className = "menu-order-editor-list";
    wrapper.appendChild(listEl);

    return wrapper;
  }

  async function loadState(): Promise<void> {
    const order = await loadConfig<MenuOrder>(
      bridge,
      STORAGE_KEYS.MENU_ORDER,
      [],
    );
    entries = applyMenuOrder(DEFAULT_MENU_ENTRIES, order);
    refreshList();
  }

  return {
    mount(target: HTMLElement): void {
      container = target;
      rootEl = render();
      container.appendChild(rootEl);
      refreshList();
      void loadState();
    },

    unmount(): void {
      rootEl?.remove();
      rootEl = null;
      container = null;
      listEl = null;
      errorEl = null;
    },
  };
}
