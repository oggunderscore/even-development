// Feature: foresight-webapp-ui
// ProfileHeader component — renders avatar + username in top-right corner with dropdown toggle.

export interface ProfileHeaderOptions {
  container: HTMLElement;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  /**
   * Renders a "Sign Out" item in the dropdown when provided. Without it there
   * is no reachable sign-out control anywhere in the app.
   */
  onSignOut?: () => void;
}

export interface ProfileHeader {
  render(): void;
  update(
    username: string | null,
    email: string | null,
    avatarUrl: string | null,
  ): void;
  dispose(): void;
}

/**
 * Truncates a username to 20 characters max.
 * If the username exceeds 20 characters, returns the first 17 characters + "...".
 */
export function formatUsername(username: string): string {
  if (username.length <= 20) {
    return username;
  }
  return username.slice(0, 17) + "...";
}

/**
 * Returns the uppercase first character of a username for use as an avatar initial.
 */
export function getAvatarInitial(username: string): string {
  return username.charAt(0).toUpperCase();
}

/**
 * Creates a ProfileHeader component that renders into the given container.
 * Displays an avatar (image or initial-based fallback) and username in the top-right corner.
 * Clicking toggles a dropdown showing full username + email.
 * Hidden entirely when unauthenticated (all user data is null).
 */
export function createProfileHeader(
  options: ProfileHeaderOptions,
): ProfileHeader {
  const { container, onSignOut } = options;
  let username = options.username;
  let email = options.email;
  let avatarUrl = options.avatarUrl;

  let headerEl: HTMLElement | null = null;
  let dropdownEl: HTMLElement | null = null;
  let isDropdownOpen = false;

  // Bound handler for outside clicks
  const onDocumentClick = (e: Event) => {
    if (!headerEl) return;
    if (!headerEl.contains(e.target as Node)) {
      closeDropdown();
    }
  };

  function isAuthenticated(): boolean {
    return username !== null || email !== null || avatarUrl !== null;
  }

  function buildAvatarElement(): HTMLElement {
    if (avatarUrl) {
      const img = document.createElement("img");
      img.className = "profile-header-avatar-img";
      img.src = avatarUrl;
      img.alt = username ? `${username}'s avatar` : "User avatar";
      return img;
    }

    const fallback = document.createElement("div");
    fallback.className = "profile-header-avatar-fallback";

    if (username) {
      fallback.textContent = getAvatarInitial(username);
    } else {
      // Generic placeholder when both picture and username are unavailable
      fallback.textContent = "?";
      fallback.classList.add("profile-header-avatar-placeholder");
    }

    return fallback;
  }

  function buildHeader(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "profile-header-wrapper";

    const trigger = document.createElement("button");
    trigger.className = "profile-header-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-label", "Account menu");

    // Avatar
    const avatar = buildAvatarElement();
    trigger.appendChild(avatar);

    // Username display (only if username is available)
    if (username) {
      const usernameEl = document.createElement("span");
      usernameEl.className = "profile-header-username";
      usernameEl.textContent = formatUsername(username);
      trigger.appendChild(usernameEl);
    }

    trigger.addEventListener("click", toggleDropdown);
    wrapper.appendChild(trigger);

    // Dropdown panel
    const dropdown = document.createElement("div");
    dropdown.className = "profile-header-dropdown";
    dropdown.setAttribute("role", "menu");
    dropdown.hidden = true;

    if (username) {
      const userLine = document.createElement("div");
      userLine.className = "profile-header-dropdown-username";
      userLine.textContent = username;
      dropdown.appendChild(userLine);
    }

    if (email) {
      const emailLine = document.createElement("div");
      emailLine.className = "profile-header-dropdown-email";
      emailLine.textContent = email;
      dropdown.appendChild(emailLine);
    }

    if (onSignOut) {
      const signOutBtn = document.createElement("button");
      signOutBtn.type = "button";
      signOutBtn.className = "profile-header-signout";
      signOutBtn.setAttribute("role", "menuitem");
      signOutBtn.textContent = "Sign Out";
      signOutBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDropdown();
        onSignOut();
      });
      dropdown.appendChild(signOutBtn);
    }

    wrapper.appendChild(dropdown);
    dropdownEl = dropdown;

    return wrapper;
  }

  function toggleDropdown(): void {
    if (isDropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function openDropdown(): void {
    if (!dropdownEl || !headerEl) return;
    isDropdownOpen = true;
    dropdownEl.hidden = false;
    const trigger = headerEl.querySelector(
      ".profile-header-trigger",
    ) as HTMLElement | null;
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
    }
  }

  function closeDropdown(): void {
    if (!dropdownEl || !headerEl) return;
    isDropdownOpen = false;
    dropdownEl.hidden = true;
    const trigger = headerEl.querySelector(
      ".profile-header-trigger",
    ) as HTMLElement | null;
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
  }

  function render(): void {
    // Clear any existing content
    dispose();

    if (!isAuthenticated()) {
      // Hidden when unauthenticated
      return;
    }

    headerEl = buildHeader();
    container.appendChild(headerEl);

    // Listen for outside clicks to close dropdown
    document.addEventListener("click", onDocumentClick);
  }

  function update(
    newUsername: string | null,
    newEmail: string | null,
    newAvatarUrl: string | null,
  ): void {
    username = newUsername;
    email = newEmail;
    avatarUrl = newAvatarUrl;
    render();
  }

  function dispose(): void {
    document.removeEventListener("click", onDocumentClick);
    if (headerEl && headerEl.parentNode) {
      headerEl.parentNode.removeChild(headerEl);
    }
    headerEl = null;
    dropdownEl = null;
    isDropdownOpen = false;
  }

  return {
    render,
    update,
    dispose,
  };
}
