/**
 * Welcome/Onboarding flow for new users.
 *
 * Flow:
 * 1. "Welcome to Foresight" splash — waits for login from phone
 * 2. Once logged in (profile written via phone app): "ようこそ、<username> to Foresight"
 * 3. Tap to proceed to Home screen
 *
 * Users CANNOT proceed past the splash until they log in on the phone.
 * The phone app writes the user profile to localStorage via the bridge,
 * which the glasses detect via polling.
 */

import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { UserStore } from "../user/user-store";

export type WelcomeStep = "waiting-for-login" | "greeting" | "done";

export interface WelcomeScreen {
  getCurrentStep(): WelcomeStep;
  render(): string;
  handleTap(): void;
  onComplete(callback: () => void): void;
  dispose(): void;
}

/**
 * Creates the welcome/onboarding screen flow.
 *
 * The splash screen polls for a logged-in user profile every 2 seconds.
 * Once detected (written by the phone companion app), it transitions
 * to the greeting screen automatically.
 */
export function createWelcomeScreen(
  bridge: any,
  userStore: UserStore,
): WelcomeScreen {
  let step: WelcomeStep = "waiting-for-login";
  let completionCallback: (() => void) | null = null;
  let loginPollTimer: ReturnType<typeof setInterval> | null = null;

  function getUsername(): string {
    const profile = userStore.getProfile();
    return profile?.username || "User";
  }

  function render(): string {
    switch (step) {
      case "waiting-for-login":
        return "Welcome to Foresight\n\nLog in on your phone\nto continue";
      case "greeting": {
        const name = getUsername();
        return `ようこそ、${name}\nto Foresight\n\n[ tap to start ]`;
      }
      case "done":
        return "";
    }
  }

  function updateDisplay(): void {
    const content = render();
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 0,
        containerName: "display",
        content,
      }),
    );
  }

  function checkForLogin(): void {
    // Re-read from bridge storage since the phone side may have written
    userStore.loadProfile().then(() => {
      const profile = userStore.getProfile();
      if (profile?.username && profile.username !== "") {
        // User logged in from phone — advance to greeting
        stopPolling();
        step = "greeting";
        updateDisplay();
      }
    });
  }

  function startPolling(): void {
    // Poll every 2 seconds for user profile written by phone app
    loginPollTimer = setInterval(checkForLogin, 2000);
  }

  function stopPolling(): void {
    if (loginPollTimer !== null) {
      clearInterval(loginPollTimer);
      loginPollTimer = null;
    }
  }

  function handleTap(): void {
    switch (step) {
      case "waiting-for-login":
        // Cannot proceed — user must log in on phone first
        // Re-render to reinforce the message
        updateDisplay();
        break;
      case "greeting":
        // Complete onboarding, transition to home
        userStore.completeOnboarding().then(() => {
          step = "done";
          if (completionCallback) completionCallback();
        });
        break;
      case "done":
        break;
    }
  }

  function onComplete(callback: () => void): void {
    completionCallback = callback;
  }

  function dispose(): void {
    stopPolling();
  }

  // Show initial splash and start polling for login
  updateDisplay();
  startPolling();

  return {
    getCurrentStep: () => step,
    render,
    handleTap,
    onComplete,
    dispose,
  };
}
