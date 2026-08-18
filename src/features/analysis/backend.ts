/**
 * Which engine analyzes an imported video: "device" (the racquet-analyzer
 * local module — no server needed) or "server" (the analysis server). The
 * user's choice persists as a tiny versioned JSON file in the documents
 * sandbox (the serverConfig.ts pattern), defaulting to "device".
 *
 * The choice is a *preference*; `resolveBackend` turns it into the backend the
 * flow actually uses, falling back to "server" whenever the native module is
 * unavailable — in Expo Go the module simply does not exist, and that must
 * degrade to the server path, never crash. Availability itself comes from
 * deviceClient's require-in-try/catch loader.
 */
import { File, Paths } from "expo-file-system";

import { loadRacquetAnalyzer, type RacquetAnalyzerLoader } from "./deviceClient";

export type AnalysisBackend = "device" | "server";

export const DEFAULT_ANALYSIS_BACKEND: AnalysisBackend = "device";

const CONFIG_FILE_NAME = "analysis-backend.json";

/**
 * True when the racquet-analyzer module loads AND exposes the contract's API.
 * False in Expo Go or any build without the local module. Never throws.
 */
export function isDeviceAnalysisAvailable(loader?: RacquetAnalyzerLoader): boolean {
  return loadRacquetAnalyzer(loader) !== null;
}

/**
 * Pure: the backend the import flow actually uses. "device" requires both the
 * setting and a loadable module; anything else runs the server flow.
 */
export function resolveBackend(
  setting: AnalysisBackend,
  deviceAvailable: boolean,
): AnalysisBackend {
  return setting === "device" && deviceAvailable ? "device" : "server";
}

/** Pure: narrow a persisted config file to a backend, or null. Never throws. */
export function parseBackendSetting(raw: string): AnalysisBackend | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.v !== 1) return null;
  return record.backend === "device" || record.backend === "server" ? record.backend : null;
}

function configFile(): File {
  return new File(Paths.document, CONFIG_FILE_NAME);
}

/** The saved backend, or the default when unset/unreadable. Never throws. */
export function loadAnalysisBackend(): AnalysisBackend {
  try {
    const file = configFile();
    if (!file.exists) return DEFAULT_ANALYSIS_BACKEND;
    return parseBackendSetting(file.textSync()) ?? DEFAULT_ANALYSIS_BACKEND;
  } catch {
    return DEFAULT_ANALYSIS_BACKEND;
  }
}
