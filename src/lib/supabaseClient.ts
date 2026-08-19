/**
 * The Supabase client for the app. The URL and publishable key ship in the
 * bundle by design (row-level security is the real gate, same as the web
 * client); EXPO_PUBLIC_* env vars can override them per-build.
 *
 * Session persistence uses the app's own sidecar pattern — a JSON file in the
 * documents sandbox — instead of AsyncStorage, so no extra native module is
 * needed. The adapter is defensive: a corrupt or missing file reads as
 * "signed out", never as a crash.
 */
import { createClient } from "@supabase/supabase-js";
import { File, Paths } from "expo-file-system";

const SESSION_FILE_NAME = "auth-session.json";

function sessionFile(): File {
  return new File(Paths.document, SESSION_FILE_NAME);
}

const fileStorage = {
  getItem(_key: string): string | null {
    try {
      const file = sessionFile();
      return file.exists ? file.textSync() : null;
    } catch {
      return null;
    }
  },
  setItem(_key: string, value: string): void {
    try {
      sessionFile().write(value);
    } catch {
      // Not being able to persist the session is survivable — the user just
      // signs in again next launch.
    }
  },
  removeItem(_key: string): void {
    try {
      const file = sessionFile();
      if (file.exists) file.delete();
    } catch {
      // Already gone is fine.
    }
  },
};

/** Static property access only — Metro inlines EXPO_PUBLIC_* at build time. */
function pick(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export const SUPABASE_URL = pick(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  "https://olljogfjesovpfjxraxf.supabase.co",
);

const SUPABASE_KEY = pick(
  process.env.EXPO_PUBLIC_SUPABASE_KEY,
  "sb_publishable_Hj6dRUv2c0lPSUo81HFE0g_HSDk5mGd",
);

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: fileStorage,
    persistSession: true,
    autoRefreshToken: true,
    // No OAuth redirects land in a native app's URL bar.
    detectSessionInUrl: false,
  },
});
