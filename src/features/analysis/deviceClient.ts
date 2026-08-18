/**
 * Wrapper around the "racquet-analyzer" Expo local module — the on-device
 * counterpart of importClient.ts. The native side (modules/racquet-analyzer/)
 * extracts a mid-video reference frame and runs the full analysis, returning
 * the same schemaVersion-1 `analysis.json` string the server produces; every
 * value that crosses the native bridge is narrowed from `unknown` here and the
 * returned JSON goes through `parseAnalysis` before anyone persists it.
 *
 * The module is loaded with `require` inside try/catch — NEVER a top-level
 * static import — because in Expo Go the native module does not exist and the
 * module's own `requireNativeModule` throws at import time. A failed load
 * degrades to `null` (→ the server backend), not a crash. Failures surface as
 * `DeviceAnalysisError`s whose messages are written for the user, mirroring
 * ImportServerError. The loader/module parameters are injectable for tests
 * (the makeImportedAnalysisId pattern).
 */
import { CORNER_ORDER, type CourtCorners, type JobStatus } from "./jobContract";
import { parseAnalysis } from "./types";

/** A failure whose `message` is written for the user, not a stack trace. */
export class DeviceAnalysisError extends Error {}

/** Result of extractReferenceFrame: a JPEG in the app cache directory. */
export interface ReferenceFrame {
  uri: string;
  width: number;
  height: number;
}

export interface EventSubscription {
  remove(): void;
}

/**
 * The native module contract (modules/racquet-analyzer/, JS module name
 * RacquetAnalyzer). Returns are typed `unknown`/loose because the bridge is a
 * boundary — the wrappers below narrow every result before use.
 */
export interface RacquetAnalyzerModule {
  extractReferenceFrame(videoUri: string): Promise<unknown>;
  analyzeMatch(videoUri: string, cornersJson: string, optionsJson: string): Promise<unknown>;
  addListener(eventName: string, listener: (event: unknown) => void): unknown;
  /** Added after v1 — older installed binaries may not have it. */
  compressVideo?(videoUri: string): Promise<unknown>;
}

export type RacquetAnalyzerLoader = () => unknown;

// Must be a runtime require inside try/catch — a static import would crash
// Expo Go, where the native half of the module does not exist.
const defaultLoader: RacquetAnalyzerLoader = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("racquet-analyzer") as unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowModule(value: unknown): RacquetAnalyzerModule | null {
  if (!isRecord(value)) return null;
  return typeof value.extractReferenceFrame === "function" &&
    typeof value.analyzeMatch === "function" &&
    typeof value.addListener === "function"
    ? (value as unknown as RacquetAnalyzerModule)
    : null;
}

/**
 * The native module, or null when it cannot be loaded (Expo Go, or a build
 * without the local module) or does not expose the contract's API. Accepts
 * either a default export (the usual local-module `index.ts` shape) or the
 * functions on the module record itself. Never throws.
 */
export function loadRacquetAnalyzer(
  loader: RacquetAnalyzerLoader = defaultLoader,
): RacquetAnalyzerModule | null {
  // The WHOLE body is guarded, not just the require: the module's default
  // export resolves the native module lazily behind getters, so merely
  // *reading* a property can throw when the native half is missing from the
  // binary. Any throw here means "unavailable" → the server backend.
  try {
    const exported = loader();
    const viaDefault = isRecord(exported) ? narrowModule(exported.default) : null;
    return viaDefault ?? narrowModule(exported);
  } catch {
    return null;
  }
}

const UNAVAILABLE_MESSAGE =
  "On-device analysis isn't available in this build. Switch to the analysis server in Settings.";

function requireModule(module: RacquetAnalyzerModule | null): RacquetAnalyzerModule {
  if (module === null) throw new DeviceAnalysisError(UNAVAILABLE_MESSAGE);
  return module;
}

/** The contract's analysisProgress stages, in pipeline order. */
export const DEVICE_STAGES = ["decoding", "pose", "audio", "stats"] as const;

export type DeviceStage = (typeof DEVICE_STAGES)[number];

const STAGE_MESSAGES: Record<DeviceStage, string> = {
  decoding: "Decoding video…",
  pose: "Tracking players…",
  audio: "Listening for shots…",
  stats: "Computing match stats…",
};

/**
 * Map a native "analysisProgress" event onto the server flow's stage model —
 * a JobStatus in the "analyzing" state with the stage as the human-readable
 * message — so the progress UI renders both backends identically. Malformed
 * events (unknown stage, junk payload) map to null and are dropped.
 */
export function progressEventToJobStatus(event: unknown): JobStatus | null {
  if (!isRecord(event)) return null;
  const stage = event.stage;
  if (typeof stage !== "string" || !(DEVICE_STAGES as readonly string[]).includes(stage)) {
    return null;
  }
  const progressPct =
    typeof event.pct === "number" && Number.isFinite(event.pct)
      ? Math.min(100, Math.max(0, event.pct))
      : null;
  return { status: "analyzing", progressPct, message: STAGE_MESSAGES[stage as DeviceStage] };
}

/** 4-dp rounding WITHOUT clamping — device corners may sit outside 0..1. */
function roundCoord(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Corners payload for analyzeMatch: {"frontLeft":[nx,ny], …}, the same wire
 * shape as the server's cornersBody but unclamped, because the module contract
 * allows corners outside the camera frame.
 */
export function deviceCornersJson(corners: CourtCorners): string {
  const payload: Record<string, [number, number]> = {};
  for (const cell of CORNER_ORDER) {
    const point = corners[cell];
    payload[cell] = [roundCoord(point.x), roundCoord(point.y)];
  }
  return JSON.stringify(payload);
}

/** Contract default sampling rate for the on-device pipeline. */
export const DEVICE_SAMPLE_FPS = 8;

export function deviceOptionsJson(sampleFps: number = DEVICE_SAMPLE_FPS): string {
  return JSON.stringify({ sampleFps });
}

/**
 * Extract the mid-video reference frame for the corner picker. Rejects with a
 * DeviceAnalysisError on native failure or a malformed result.
 */
export async function extractDeviceReferenceFrame(
  videoUri: string,
  module: RacquetAnalyzerModule | null = loadRacquetAnalyzer(),
): Promise<ReferenceFrame> {
  const analyzer = requireModule(module);
  let result: unknown;
  try {
    result = await analyzer.extractReferenceFrame(videoUri);
  } catch {
    throw new DeviceAnalysisError(
      "Couldn't read a frame from this video. It may use a format this device can't decode.",
    );
  }
  if (
    !isRecord(result) ||
    typeof result.uri !== "string" ||
    result.uri.length === 0 ||
    typeof result.width !== "number" ||
    typeof result.height !== "number"
  ) {
    throw new DeviceAnalysisError("The on-device analyzer sent back an unreadable video frame.");
  }
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Narrow addListener's return to something removable; degrade to a no-op. */
function narrowSubscription(value: unknown): EventSubscription {
  return isRecord(value) && typeof value.remove === "function"
    ? (value as unknown as EventSubscription)
    : { remove: () => {} };
}

/**
 * Run the full on-device analysis: subscribe to "analysisProgress", call
 * analyzeMatch, validate the returned JSON with `parseAnalysis`, and resolve
 * with the RAW string (callers persist exactly what the analyzer wrote, the
 * same rule as the server flow). Always removes the progress subscription.
 */
export async function runDeviceAnalysis(
  videoUri: string,
  corners: CourtCorners,
  onProgress: (status: JobStatus) => void,
  module: RacquetAnalyzerModule | null = loadRacquetAnalyzer(),
): Promise<string> {
  const analyzer = requireModule(module);
  const subscription = narrowSubscription(
    analyzer.addListener("analysisProgress", (event) => {
      const status = progressEventToJobStatus(event);
      if (status !== null) onProgress(status);
    }),
  );
  let raw: unknown;
  try {
    raw = await analyzer.analyzeMatch(videoUri, deviceCornersJson(corners), deviceOptionsJson());
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : "";
    throw new DeviceAnalysisError(`The on-device analysis failed${detail}. Try again.`);
  } finally {
    subscription.remove();
  }
  if (typeof raw !== "string" || parseAnalysis(raw) === null) {
    throw new DeviceAnalysisError(
      "The analysis finished but its result uses a format this app version can't read.",
    );
  }
  return raw;
}

/**
 * Best-effort 960x540 export before a server upload — an optimization, never a
 * blocker. Returns the original URI when the module is missing (Expo Go, older
 * installed binaries without compressVideo) or the export fails for any
 * reason; the server accepts full-size uploads either way.
 */
export async function compressForUpload(
  videoUri: string,
  module: RacquetAnalyzerModule | null = loadRacquetAnalyzer(),
): Promise<string> {
  if (module === null || typeof module.compressVideo !== "function") return videoUri;
  try {
    const result = await module.compressVideo(videoUri);
    if (
      typeof result === "object" &&
      result !== null &&
      "uri" in result &&
      typeof (result as { uri: unknown }).uri === "string" &&
      (result as { uri: string }).uri.length > 0
    ) {
      return (result as { uri: string }).uri;
    }
    return videoUri;
  } catch {
    return videoUri;
  }
}
