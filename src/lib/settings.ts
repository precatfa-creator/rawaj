import { supabase } from '../db/supabase';

/**
 * Per-user preferences.
 *
 * Two homes, on purpose. A *preference* — something the user decided and expects
 * to find again on another machine — lives in `user_settings` in Postgres. The
 * *state* of the interface right now — which groups happen to be open — lives in
 * `localStorage`: it changes on every click, it differs per device, and writing
 * it to a server would mean a request per chevron and a race between two tabs.
 */

export type SidebarGroupsMode = 'collapsible' | 'always';

export interface UserSettings {
  /** `collapsible` lets groups fold; `always` keeps them open and hides the toggles. */
  sidebarGroups: SidebarGroupsMode;
}

/** What a user who has never opened the settings screen gets — today's behaviour. */
export const DEFAULT_SETTINGS: UserSettings = {
  sidebarGroups: 'always',
};

/** Storage key per setting, so the table stays readable in SQL. */
const KEYS: Record<keyof UserSettings, string> = {
  sidebarGroups: 'sidebar.groups',
};

export const loadSettings = async (): Promise<UserSettings> => {
  const { data, error } = await supabase.from('user_settings').select('key,value');
  if (error) {
    console.error('user settings failed to load', error);
    return DEFAULT_SETTINGS;
  }

  const byKey = new Map((data ?? []).map(row => [row.key as string, row.value]));
  const mode = byKey.get(KEYS.sidebarGroups);
  return {
    // An unknown value falls back rather than propagating: the column is jsonb
    // and nothing stops a hand-written row holding anything at all.
    sidebarGroups: mode === 'collapsible' || mode === 'always' ? mode : DEFAULT_SETTINGS.sidebarGroups,
  };
};

/**
 * Writes one preference for the signed-in user.
 *
 * `user_id` is sent explicitly because the row is keyed on it — RLS then checks
 * that what was sent is the caller's own id, so a forged one is refused rather
 * than silently written.
 */
export const saveSetting = async <K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K],
): Promise<boolean> => {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return false;

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, key: KEYS[key], value }, { onConflict: 'user_id,key' });

  if (error) {
    console.error('user setting failed to save', error);
    return false;
  }
  return true;
};

// ---- transient interface state ----

const COLLAPSED_KEY = 'rawaj.sidebar.collapsed';

/**
 * Every key this app owns in `localStorage`, listed so "clear cache" can remove
 * them by name. The keys keep their old prefix on purpose: renaming them with
 * the app would silently discard the state of everyone already using it.
 */
const DEVICE_KEYS = [COLLAPSED_KEY, 'rawaj.assistant.size'];

/** Group titles the user has folded, on this device. */
export const loadCollapsedGroups = (): string[] => {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    // Private browsing, a disabled store, or something else's key in this slot.
    return [];
  }
};

export const saveCollapsedGroups = (titles: string[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(titles));
  } catch {
    // Nothing to do and nothing worth telling the user: the sidebar still works,
    // it just forgets which groups were folded when the tab is closed.
  }
};

/**
 * Throws away everything cached on this device: the service worker's copy of
 * the app, and the bits of interface state kept in `localStorage`.
 *
 * Deliberately *not* `localStorage.clear()` — the Supabase session lives in
 * that same store, and "clear cache" must not sign the user out. Preferences
 * are in Postgres, so nothing the user chose is lost either way.
 */
export const clearCachedData = async (): Promise<void> => {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }

  // A surviving worker would refill the cache from its own copies on the next
  // load, so it is unregistered too; the next visit registers a fresh one.
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }

  for (const key of DEVICE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Same reason as everywhere else here: a blocked store is not an error
      // worth surfacing, the value simply was not there to begin with.
    }
  }
};
