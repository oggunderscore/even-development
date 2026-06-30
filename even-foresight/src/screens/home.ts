/**
 * Home screen — displays HUD widgets (clock, weather, etc.) and
 * shows navigation hints to new users.
 */

import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";

export interface HomeScreen {
  render(): string;
  startRefresh(): void;
  stopRefresh(): void;
  handleTap(): void;
  handleDoubleTap(): void;
}

/**
 * Creates the Home screen with HUD widgets.
 *
 * @param bridge - SDK bridge for display
 * @param username - User's display name
 * @param onMenuRequest - Called when user double-taps to open menu
 */
export function createHomeScreen(
  bridge: any,
  username: string,
  onMenuRequest: () => void,
): HomeScreen {
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let showingHint = true;
  let hintTimeout: ReturnType<typeof setTimeout> | null = null;

  function formatTime(): string {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const period = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${period}`;
  }

  function getWeatherPlaceholder(): string {
    return "☀ --°F";
  }

  function render(): string {
    const time = formatTime();
    const weather = getWeatherPlaceholder();
    const greeting = `Hi, ${username}`;

    let content = `${time}  ${weather}\n${greeting}`;

    if (showingHint) {
      content += "\n\n[ double-tap → menu ]";
    }

    return content;
  }

  function updateDisplay(): void {
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content: render(),
      }),
    );
  }

  function startRefresh(): void {
    updateDisplay();

    // Refresh clock every 30 seconds
    refreshTimer = setInterval(() => {
      updateDisplay();
    }, 30_000);

    // Hide the navigation hint after 10 seconds
    if (showingHint) {
      hintTimeout = setTimeout(() => {
        showingHint = false;
        updateDisplay();
      }, 10_000);
    }
  }

  function stopRefresh(): void {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (hintTimeout) {
      clearTimeout(hintTimeout);
      hintTimeout = null;
    }
  }

  function handleTap(): void {
    // Dismiss hint on first tap if still showing
    if (showingHint) {
      showingHint = false;
      if (hintTimeout) {
        clearTimeout(hintTimeout);
        hintTimeout = null;
      }
      updateDisplay();
    }
  }

  function handleDoubleTap(): void {
    onMenuRequest();
  }

  return {
    render,
    startRefresh,
    stopRefresh,
    handleTap,
    handleDoubleTap,
  };
}
