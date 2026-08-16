/**
 * Persisted analysis-server base URL — the one piece of user configuration the
 * import flow has. Stored as a tiny JSON file in the documents sandbox
 * (`<documents>/analysis-server.json`), the same sync expo-file-system sidecar
 * pattern as recording metadata: pretty-printed, versioned, parsed defensively
 * so a corrupt file degrades to the default instead of crashing Settings.
 *
 * Default is http://localhost:8082 — right for a simulator on the same Mac as
 * the server; a physical phone on the same Wi-Fi needs the Mac's LAN IP
 * (Settings → Analysis server).
 */
import { File, Paths } from "expo-file-system";

import { DEFAULT_SERVER_BASE_URL, normalizeBaseUrl } from "./jobContract";

const CONFIG_FILE_NAME = "analysis-server.json";

function configFile(): File {
  return new File(Paths.document, CONFIG_FILE_NAME);
}

/** The saved base URL, or the default when unset/unreadable. Never throws. */
export function loadServerBaseUrl(): string {
  try {
    const file = configFile();
    if (!file.exists) return DEFAULT_SERVER_BASE_URL;
    const data: unknown = JSON.parse(file.textSync());
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return DEFAULT_SERVER_BASE_URL;
    }
    const record = data as Record<string, unknown>;
    if (record.v !== 1 || typeof record.baseUrl !== "string") return DEFAULT_SERVER_BASE_URL;
    return normalizeBaseUrl(record.baseUrl) ?? DEFAULT_SERVER_BASE_URL;
  } catch {
    return DEFAULT_SERVER_BASE_URL;
  }
}

/**
 * Normalize and persist a new base URL. Returns the stored value, or null when
 * the input is unusable (nothing is written — the previous value stands).
 */
export function saveServerBaseUrl(input: string): string | null {
  const normalized = normalizeBaseUrl(input);
  if (normalized === null) return null;
  try {
    const file = configFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ v: 1, baseUrl: normalized }, null, 2));
    return normalized;
  } catch {
    return null;
  }
}
