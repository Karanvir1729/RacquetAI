/**
 * racquet-analyzer — on-device squash match analysis (iOS, Expo local module).
 *
 * Native side lives in `ios/`; it ports `analysis/analyze.py` (Vision body
 * pose, 4-corner floor homography, audio-onset shot detection, retrieval-proxy
 * placement) and returns the full `analysis.json` string (schemaVersion 1,
 * the `src/features/analysis/types.ts` contract).
 */
import { NativeModule, requireNativeModule } from "expo";

export type AnalysisStage = "decoding" | "pose" | "audio" | "stats";

export type AnalysisProgressEvent = {
  stage: AnalysisStage;
  /** Overall progress 0..100 across all stages. */
  pct: number;
};

export type ReferenceFrame = {
  /** file:// URI of a JPEG in the app cache directory. */
  uri: string;
  width: number;
  height: number;
};

/**
 * Corner tap positions on the reference frame, normalized 0..1 in that frame.
 * Values may fall outside 0..1 — a court corner can sit outside the camera
 * frame.
 */
export type CourtCorners = {
  frontLeft: [number, number];
  frontRight: [number, number];
  backLeft: [number, number];
  backRight: [number, number];
};

export type AnalyzeOptions = {
  /** Pose sampling rate; default 8. */
  sampleFps?: number;
};

type RacquetAnalyzerEvents = {
  analysisProgress: (event: AnalysisProgressEvent) => void;
};

export type CompressedVideo = {
  /** file:// URI of the 960x540 mp4 in the app cache directory. */
  uri: string;
  bytes: number;
};

declare class RacquetAnalyzerModule extends NativeModule<RacquetAnalyzerEvents> {
  /** Extract the mid-video frame as a JPEG in the app cache directory. */
  extractReferenceFrame(videoUri: string): Promise<ReferenceFrame>;
  /** Export a 960x540 H.264 copy for upload (server downscales to 854px anyway). */
  compressVideo(videoUri: string): Promise<CompressedVideo>;
  /**
   * Run the full pipeline. `cornersJson` is `JSON.stringify(CourtCorners)`,
   * `optionsJson` is `JSON.stringify(AnalyzeOptions)`. Resolves with the
   * complete analysis.json STRING (parse with
   * `src/features/analysis/types.ts#parseAnalysis`).
   */
  analyzeMatch(videoUri: string, cornersJson: string, optionsJson: string): Promise<string>;
}

/**
 * LAZY on purpose. `requireNativeModule` throws when the native half is not in
 * the binary, and at module scope that throw happens at IMPORT time — fatal in
 * a release build, before any caller's try/catch can see it (exactly how a
 * gitignored `modules/racquet-analyzer/ios/` shipped a JS-only module to
 * TestFlight and crashed it). Resolving inside the getter moves the throw to
 * the call site, where deviceClient's loader catches it and degrades to the
 * analysis-server backend.
 */
let cached: RacquetAnalyzerModule | null = null;

function nativeModule(): RacquetAnalyzerModule {
  cached ??= requireNativeModule<RacquetAnalyzerModule>("RacquetAnalyzer");
  return cached;
}

/** Bound native method, or undefined when this binary doesn't expose it. */
function method(name: keyof RacquetAnalyzerModule): unknown {
  const target = nativeModule() as unknown as Record<string, unknown>;
  const fn = target[name as string];
  return typeof fn === "function" ? (fn as (...args: unknown[]) => unknown).bind(target) : undefined;
}

export default {
  get extractReferenceFrame() {
    return method("extractReferenceFrame");
  },
  get compressVideo() {
    return method("compressVideo");
  },
  get analyzeMatch() {
    return method("analyzeMatch");
  },
  get addListener() {
    return method("addListener");
  },
};
