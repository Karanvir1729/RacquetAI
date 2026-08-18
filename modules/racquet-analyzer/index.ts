/**
 * racquet-analyzer — on-device squash match analysis (iOS, Expo local module).
 *
 * Native side lives in `ios/`; it ports `analysis/analyze.py` (Vision body
 * pose, 4-corner floor homography, audio-onset shot detection, retrieval-proxy
 * placement) and returns the full `analysis.json` string (schemaVersion 1,
 * the `src/features/analysis/types.ts` contract).
 */
import { NativeModule, requireNativeModule, requireNativeView } from "expo";

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

// ---------------------------------------------------------------------------
// Live referee
// ---------------------------------------------------------------------------

/**
 * WHAT THE LIVE EVENTS ARE, AND WHAT THEY ARE NOT.
 *
 * The native side watches the court and emits "a rally started", "somebody
 * struck the ball", "the rally appears to have ended and the last striker was
 * X". It CANNOT decide who won a point. There is no ball tracking in this
 * project, and a squash rally ends for reasons that are entirely about the
 * ball — two bounces, the tin, out, or a retrieval that failed.
 *
 * The proposal's ceiling is a measured number, not a guess: hand-labelling
 * rally outcomes on three archive matches put "the last striker won the rally"
 * at 8/11 = 72.7% (Wilson 95% CI 43.4%–90.3%), and that was scored against the
 * TRUE last striker read off the frames — an oracle the on-device detector
 * does not match. Treat every rally end as a prompt for a human.
 */
export type LivePermissionState = "granted" | "denied" | "restricted" | "undetermined";

export type LiveRefereePermissions = {
  camera: LivePermissionState;
  microphone: LivePermissionState;
};

export type LiveSessionState = "idle" | "starting" | "running" | "stopped" | "failed";

export type LiveSessionProblem =
  | "camera-denied"
  | "microphone-denied"
  | "no-camera"
  | "configuration-failed"
  | "interrupted";

export type LiveThermalState = "nominal" | "fair" | "serious" | "critical";

export type LiveRefereeStatusEvent = {
  state: LiveSessionState;
  cameraAuthorized: boolean;
  microphoneAuthorized: boolean;
  /**
   * False when the microphone is unavailable. Shot detection here is an AUDIO
   * detector with a pose gate, so without a microphone there are no strikes
   * and no rally ends — the preview still runs and the human still referees.
   */
  detectionAvailable: boolean;
  /**
   * False when no court corners were supplied. Uncalibrated, the filter that
   * rejects people on the next court and in the gallery cannot run.
   */
  courtCalibrated: boolean;
  problem: LiveSessionProblem | null;
  thermalState: LiveThermalState;
  /** Effective pose rate; drops automatically under thermal pressure. */
  poseHz: number;
  framesProcessed: number;
  framesSkipped: number;
  poseFailures: number;
  tuning?: LiveRefereeTuning;
};

/**
 * Tracker identity, not a player. "A" is whichever person was leftmost the
 * first time two people were seen on court. The UI must let a human bind these
 * to the actual players, and re-bind them, because trackers swap.
 */
export type LiveTrackId = "A" | "B";

export type LiveRallyStartedEvent = {
  /** Seconds since the capture session started. */
  t: number;
  firstStriker: LiveTrackId;
};

export type LiveStrikeEvent = {
  t: number;
  striker: LiveTrackId;
  /** Swing measure; units differ between the wrist and ankle branches. */
  peak: number;
  /** 0 = coin flip between the two players, 1 = only one of them moved. */
  margin: number;
  fromWrist: boolean;
  indexInRally: number;
  /** False while the detector is still learning this venue's activity floor. */
  gateWarm: boolean;
};

/** What the UI should do with a proposal, decided by the measured confidence. */
export type LiveRecommendation = "confirm" | "propose" | "ask";

export type LiveRallyEndedEvent = {
  rallyStartT: number;
  lastStrikeT: number;
  decidedAtT: number;
  /** Observed silence in the gated strike stream, seconds. */
  gapS: number;
  strikes: number;
  /** The last player to strike. A PROPOSAL, never a decision. */
  proposedWinner: LiveTrackId | null;
  confidence: number;
  recommendation: LiveRecommendation;
  trigger: "silence" | "late-strike" | "max-duration";
  /** Per-failure-mode multipliers behind `confidence`. */
  factors: Record<string, number>;
  /** The measured oracle accuracy the confidence can never exceed (0.727). */
  ceiling: number;
  ceilingSampleSize: number;
  /** A sentence explaining the call, written for a human to check. */
  why: string;
};

/**
 * The rally-end rule, exposed because it is venue-sensitive and that is
 * measured, not suspected: splitting the same footage on an 8 s gap gave 47
 * shots per "rally" where 4.5 s matched the play.
 */
export type LiveRefereeTuning = {
  poseHz?: number;
  historyS?: number;
  rallyGapS?: number;
  gapConfidentS?: number;
  strikeResolveDelayS?: number;
  rallyMinStrikes?: number;
  activityQ?: number;
  activityWarmupS?: number;
  activityWindowS?: number;
  strongSwingF?: number;
  swingHistoryCount?: number;
  swingHistoryMin?: number;
  maxRallyS?: number;
};

export type LivePreviewProps = {
  /** "cover" (default) or "contain". */
  gravity?: "cover" | "contain";
  style?: unknown;
};

type RacquetAnalyzerEvents = {
  analysisProgress: (event: AnalysisProgressEvent) => void;
  liveRefereeStatus: (event: LiveRefereeStatusEvent) => void;
  liveRallyStarted: (event: LiveRallyStartedEvent) => void;
  liveStrike: (event: LiveStrikeEvent) => void;
  liveRallyEnded: (event: LiveRallyEndedEvent) => void;
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

  // --- Live referee ---
  /** Authorization state WITHOUT triggering a system prompt. */
  liveRefereePermissions(): LiveRefereePermissions;
  /** Ask for camera + microphone. Never rejects; resolves with the outcome. */
  requestLiveRefereePermissions(): Promise<LiveRefereePermissions>;
  /**
   * Start watching. `cornersJson` is the same payload analyzeMatch takes and
   * may be "" (uncalibrated). `tuningJson` is `JSON.stringify(LiveRefereeTuning)`
   * or "". Resolves with the status even when a permission was denied — the
   * referee screen must stay usable by hand regardless.
   */
  startLiveReferee(cornersJson: string, tuningJson: string): Promise<LiveRefereeStatusEvent>;
  stopLiveReferee(): Promise<LiveRefereeStatusEvent>;
  /** Poll without waiting for the next event. */
  liveRefereeStatus(): LiveRefereeStatusEvent;
  /** Re-apply the capture rotation after the device turns. */
  refreshLiveRefereeOrientation(): void;
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

/**
 * The camera preview, resolved lazily for the same reason the module is.
 *
 * It borrows the analysis session's AVCaptureSession: iOS gives the camera to
 * exactly one AVCaptureSession, so an expo-camera view cannot supply the
 * preview while this module is analysing — they would fight over the device.
 *
 * Returns null instead of throwing when the native half is missing, so a
 * screen can render its manual-only fallback.
 */
export function getLivePreviewComponent(): unknown {
  try {
    return requireNativeView("RacquetAnalyzer");
  } catch {
    return null;
  }
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
  get liveRefereePermissions() {
    return method("liveRefereePermissions");
  },
  get requestLiveRefereePermissions() {
    return method("requestLiveRefereePermissions");
  },
  get startLiveReferee() {
    return method("startLiveReferee");
  },
  get stopLiveReferee() {
    return method("stopLiveReferee");
  },
  get liveRefereeStatus() {
    return method("liveRefereeStatus");
  },
  get refreshLiveRefereeOrientation() {
    return method("refreshLiveRefereeOrientation");
  },
  getLivePreviewComponent,
};
