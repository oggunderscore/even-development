// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createProfileHeader,
  formatUsername,
  getAvatarInitial,
} from "./profile-header";

describe("ProfileHeader", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("renders avatar image when avatarUrl is provided", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: "https://example.com/avatar.png",
    });
    header.render();

    const img = container.querySelector(
      ".profile-header-avatar-img",
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://example.com/avatar.png");

    header.dispose();
  });

  it("renders initial-based fallback avatar when no avatarUrl", () => {
    const header = createProfileHeader({
      container,
      username: "Bob",
      email: "bob@example.com",
      avatarUrl: null,
    });
    header.render();

    const fallback = container.querySelector(".profile-header-avatar-fallback");
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toBe("B");

    header.dispose();
  });

  it('renders generic placeholder "?" when both avatarUrl and username are null', () => {
    const header = createProfileHeader({
      container,
      username: null,
      email: "user@example.com",
      avatarUrl: null,
    });
    header.render();

    const fallback = container.querySelector(".profile-header-avatar-fallback");
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toBe("?");
    expect(
      fallback!.classList.contains("profile-header-avatar-placeholder"),
    ).toBe(true);

    header.dispose();
  });

  it("renders truncated username for names exceeding 20 characters", () => {
    const longName = "abcdefghijklmnopqrstuvwxy"; // 25 chars
    const header = createProfileHeader({
      container,
      username: longName,
      email: "user@example.com",
      avatarUrl: null,
    });
    header.render();

    const usernameEl = container.querySelector(".profile-header-username");
    expect(usernameEl).not.toBeNull();
    expect(usernameEl!.textContent).toBe("abcdefghijklmnopq...");
    expect(usernameEl!.textContent!.length).toBeLessThanOrEqual(20);

    header.dispose();
  });

  it("dropdown opens on click (hidden is false)", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: null,
    });
    header.render();

    const trigger = container.querySelector(
      ".profile-header-trigger",
    ) as HTMLElement;
    trigger.click();

    const dropdown = container.querySelector(
      ".profile-header-dropdown",
    ) as HTMLElement;
    expect(dropdown.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    header.dispose();
  });

  it("dropdown closes on re-click (hidden is true)", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: null,
    });
    header.render();

    const trigger = container.querySelector(
      ".profile-header-trigger",
    ) as HTMLElement;
    // Open
    trigger.click();
    // Close
    trigger.click();

    const dropdown = container.querySelector(
      ".profile-header-dropdown",
    ) as HTMLElement;
    expect(dropdown.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    header.dispose();
  });

  it("dropdown closes on outside click (dispatch click on document)", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: null,
    });
    header.render();

    const trigger = container.querySelector(
      ".profile-header-trigger",
    ) as HTMLElement;
    // Open
    trigger.click();

    // Simulate outside click
    document.dispatchEvent(new Event("click", { bubbles: true }));

    const dropdown = container.querySelector(
      ".profile-header-dropdown",
    ) as HTMLElement;
    expect(dropdown.hidden).toBe(true);

    header.dispose();
  });

  it("does not render anything when unauthenticated (all null)", () => {
    const header = createProfileHeader({
      container,
      username: null,
      email: null,
      avatarUrl: null,
    });
    header.render();

    expect(container.children.length).toBe(0);

    header.dispose();
  });

  it("update method re-renders with new data", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: null,
    });
    header.render();

    expect(
      container.querySelector(".profile-header-avatar-fallback")!.textContent,
    ).toBe("A");

    header.update("bob", "bob@example.com", null);

    expect(
      container.querySelector(".profile-header-avatar-fallback")!.textContent,
    ).toBe("B");
    const usernameEl = container.querySelector(".profile-header-username");
    expect(usernameEl!.textContent).toBe("bob");

    header.dispose();
  });

  it("dispose removes all DOM and event listeners", () => {
    const header = createProfileHeader({
      container,
      username: "alice",
      email: "alice@example.com",
      avatarUrl: null,
    });
    header.render();

    expect(container.children.length).toBeGreaterThan(0);

    header.dispose();

    expect(container.children.length).toBe(0);
  });
});

describe("formatUsername", () => {
  it("returns the username as-is when 20 chars or fewer", () => {
    expect(formatUsername("short")).toBe("short");
    expect(formatUsername("exactly_twenty_char!")).toBe("exactly_twenty_char!");
  });

  it("truncates to 17 chars + '...' when exceeding 20 chars", () => {
    const long = "a".repeat(25);
    expect(formatUsername(long)).toBe("a".repeat(17) + "...");
  });
});

describe("getAvatarInitial", () => {
  it("returns uppercase first character", () => {
    expect(getAvatarInitial("alice")).toBe("A");
    expect(getAvatarInitial("Bob")).toBe("B");
  });
});
