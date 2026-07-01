/**
 * Welcome/Onboarding flow for new users.
 *
 * Flow:
 * 1. Typing animation: "Welcome to Foresight" → "Your new Even Home" → "Login on your phone to continue"
 * 2. Once animation completes, polls for login from phone
 * 3. Once logged in (profile written via phone app): "ようこそ、<username> to Foresight"
 * 4. Tap to proceed to Home screen
 *
 * Users CANNOT proceed past the splash until they log in on the phone.
 * The phone app writes the user profile to localStorage via the bridge,
 * which the glasses detect via polling.
 */

import { TextContainerUpgrade } from "@evenrealities/even_hub_sdk";
import type { UserStore } from "../user/user-store";

export type WelcomeStep = "typing" | "waiting-for-login" | "greeting" | "done";

export interface WelcomeScreen {
  getCurrentStep(): WelcomeStep;
  render(): string;
  handleTap(): void;
  onComplete(callback: () => void): void;
  dispose(): void;
}

// ── Typing Animation Config ──────────────────────────────────────────────────

const TYPING_LINES = [
  "Welcome to Foresight",
  "Your new Even Home",
  "Log in on phone to continue",
];

/** Milliseconds between each character typed */
const CHAR_DELAY_MS = 60;

/** Pause between finishing one line and starting the next */
const LINE_PAUSE_MS = 800;

/** Pause after last line before transitioning to waiting state */
const FINAL_PAUSE_MS = 1200;

// ── Welcome Screen ───────────────────────────────────────────────────────────

/**
 * Creates the welcome/onboarding screen flow.
 *
 * Starts with a typing animation that reveals three lines sequentially,
 * then polls for a logged-in user profile every 2 seconds.
 * Once detected (written by the phone companion app), it transitions
 * to the greeting screen automatically.
 */
export function createWelcomeScreen(
  bridge: any,
  userStore: UserStore,
): WelcomeScreen {
  let step: WelcomeStep = "typing";
  let completionCallback: (() => void) | null = null;
  let loginPollTimer: ReturnType<typeof setInterval> | null = null;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  // Typing animation state
  let currentLineIndex = 0;
  let currentCharIndex = 0;
  let displayedLines: string[] = [];

  function getUsername(): string {
    const profile = userStore.getProfile();
    return profile?.username || "User";
  }

  function renderTypingFrame(): string {
    // Build content: completed lines + current partial line
    const lines: string[] = [];

    // Completed lines
    for (const line of displayedLines) {
      lines.push(line);
    }

    // Current line being typed (if we haven't finished all lines)
    if (currentLineIndex < TYPING_LINES.length) {
      const partial = TYPING_LINES[currentLineIndex].slice(0, currentCharIndex);
      lines.push(partial + "▌"); // Cursor character
    }

    return lines.join("\n");
  }

  function render(): string {
    switch (step) {
      case "typing":
        return renderTypingFrame();
      case "waiting-for-login": {
        const lines: string[] = [];
        for (const line of TYPING_LINES) {
          lines.push(line);
        }
        return lines.join("\n");
      }
      case "greeting": {
        const name = getUsername();
        const lines = [
          `ようこそ、${name}`,
          "to Foresight",
          "",
          "[ tap to start ]",
        ];
        return lines.join("\n");
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

  function typeNextChar(): void {
    if (step !== "typing") return;

    if (currentLineIndex >= TYPING_LINES.length) {
      // All lines typed — pause then transition to waiting
      typingTimer = setTimeout(() => {
        step = "waiting-for-login";
        updateDisplay();
        startPolling();
      }, FINAL_PAUSE_MS);
      return;
    }

    const currentLine = TYPING_LINES[currentLineIndex];

    if (currentCharIndex <= currentLine.length) {
      // Still typing the current line
      updateDisplay();
      currentCharIndex++;
      typingTimer = setTimeout(typeNextChar, CHAR_DELAY_MS);
    } else {
      // Line complete — push to displayed, pause, then start next line
      displayedLines.push(currentLine);
      currentLineIndex++;
      currentCharIndex = 0;
      typingTimer = setTimeout(typeNextChar, LINE_PAUSE_MS);
    }
  }

  function startTypingAnimation(): void {
    currentLineIndex = 0;
    currentCharIndex = 0;
    displayedLines = [];
    typeNextChar();
  }

  function checkForLogin(): void {
    // Re-read from bridge storage since the phone side may have written
    userStore.loadProfile().then(() => {
      const profile = userStore.getProfile();
      if (profile?.username && profile.username !== "") {
        // User logged in from phone — skip greeting, go straight to home
        stopPolling();
        step = "done";
        userStore.completeOnboarding().then(() => {
          if (completionCallback) completionCallback();
        });
      }
    });
  }

  function startPolling(): void {
    // Also check immediately in case they logged in during the animation
    checkForLogin();
    // Poll every 2 seconds for user profile written by phone app
    loginPollTimer = setInterval(checkForLogin, 2000);
  }

  function stopPolling(): void {
    if (loginPollTimer !== null) {
      clearInterval(loginPollTimer);
      loginPollTimer = null;
    }
  }

  function stopTyping(): void {
    if (typingTimer !== null) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
  }

  function handleTap(): void {
    switch (step) {
      case "typing":
        // Skip the animation — show all lines immediately
        stopTyping();
        displayedLines = [...TYPING_LINES];
        currentLineIndex = TYPING_LINES.length;
        step = "waiting-for-login";
        updateDisplay();
        startPolling();
        break;
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
    stopTyping();
    stopPolling();
  }

  // Start the typing animation after a brief delay to allow the display
  // hardware to fully initialize after createStartUpPageContainer resolves.
  typingTimer = setTimeout(() => startTypingAnimation(), 300);

  return {
    getCurrentStep: () => step,
    render,
    handleTap,
    onComplete,
    dispose,
  };
}
