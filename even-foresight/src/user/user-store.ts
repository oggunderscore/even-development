/**
 * User profile storage — persisted locally via SDK bridge localStorage.
 * Will later migrate to Firebase for cloud sync.
 */

export interface UserProfile {
  username: string;
  createdAt: number;
  onboardingComplete: boolean;
}

const USER_PROFILE_KEY = "foresight-user-profile-v1";

export interface UserStore {
  getProfile(): UserProfile | null;
  saveProfile(profile: UserProfile): Promise<void>;
  isOnboarded(): boolean;
  completeOnboarding(): Promise<void>;
  loadProfile(): Promise<void>;
}

/**
 * Creates a UserStore backed by the SDK's localStorage bridge.
 *
 * Since the SDK's getLocalStorage/setLocalStorage are async (Promise-based),
 * we cache the profile in memory after the initial async load. Call
 * loadProfile() once at startup to hydrate the cache.
 */
export function createUserStore(bridge: any): UserStore {
  let cachedProfile: UserProfile | null = null;

  async function loadProfile(): Promise<void> {
    try {
      const raw = await bridge.getLocalStorage(USER_PROFILE_KEY);
      if (raw) {
        cachedProfile = JSON.parse(raw) as UserProfile;
      }
    } catch {
      cachedProfile = null;
    }
  }

  function getProfile(): UserProfile | null {
    return cachedProfile;
  }

  async function saveProfile(profile: UserProfile): Promise<void> {
    cachedProfile = profile;
    await bridge.setLocalStorage(USER_PROFILE_KEY, JSON.stringify(profile));
  }

  function isOnboarded(): boolean {
    return cachedProfile?.onboardingComplete === true;
  }

  async function completeOnboarding(): Promise<void> {
    if (cachedProfile) {
      cachedProfile.onboardingComplete = true;
      await saveProfile(cachedProfile);
    }
  }

  return {
    getProfile,
    saveProfile,
    isOnboarded,
    completeOnboarding,
    loadProfile,
  };
}
