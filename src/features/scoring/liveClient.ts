/**
 * The JS side of the live referee: load the native session if this binary has
 * one, narrow everything that crosses the bridge, and turn a rally-end event
 * into a PROPOSAL the human confirms.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE DELIBERATELY CANNOT SCORE A POINT
 * ---------------------------------------------------------------------------
 * Nothing here calls `awardRally`, and nothing here returns a `ScoreEvent`.
 * The screen owns that call and a human owns the screen. The reason is
 * measured, not defensive:
 *
 *   - there is no ball tracking in this project, and a squash rally ends for
 *     reasons that are entirely about the ball (two bounces, the tin, out, or
 *     a retrieval that failed);
 *   - hand-labelling three archive matches put "the last player to strike the
 *     ball won the rally" at 8/11 = 72.7%, Wilson 95% CI 43.4%–90.3%, n = 11 —
 *     and that was scored against the TRUE last striker read off the frames,
 *     an oracle the on-device detector does not match;
 *   - 1 of 15 inspected breaks in the shot stream was not a rally end at all,
 *     and the detector's "last shot" is often a bounce or a ball pickup
 *     seconds AFTER the point was already over.
 *
 * A referee that awards wrong points is worse than no referee at all, so the
 * contract is: the app watches and proposes, the human confirms.
 *
 * The loader follows deviceClient.ts's require-in-try/catch rule exactly — the
 * WHOLE body is guarded, not just the require, because the module resolves its
 * native half behind getters and merely READING a property throws when that
 * half is missing. Six TestFlight builds crashed at import on precisely that.
 */
import { OTHER_SIDE, type Side } from "./types";

/** Tracker identity, not a player — see `TrackBinding`. */
export type LiveTrackId = "A" | "B";

export type LivePermissionState = "granted" | "denied" | "restricted" | "undetermined";

export interface LivePermissions {
  camera: LivePermissionState;
  microphone: LivePermissionState;
}

export type LiveSessionState = "idle" | "starting" | "running" | "stopped" | "failed";

export type LiveSessionProblem =
  | "camera-denied"
  | "microphone-denied"
  | "no-camera"
  | "configuration-failed"
  | "interrupted";

export type LiveThermalState = "nominal" | "fair" | "serious" | "critical";

export interface LiveStatus {
  state: LiveSessionState;
  cameraAuthorized: boolean;
  microphoneAuthorized: boolean;
  /** Without a microphone there is no shot detection at all — see the README. */
  detectionAvailable: boolean;
  courtCalibrated: boolean;
  problem: LiveSessionProblem | null;
  thermalState: LiveThermalState;
  poseHz: number;
  framesProcessed: number;
  framesSkipped: number;
  poseFailures: number;
}

export interface LiveRallyStarted {
  t: number;
  firstStriker: LiveTrackId;
}

export interface LiveStrike {
  t: number;
  striker: LiveTrackId;
  peak: number;
  margin: number;
  fromWrist: boolean;
  indexInRally: number;
  gateWarm: boolean;
}

export type LiveRecommendation = "confirm" | "propose" | "ask";

export interface LiveRallyEnded {
  rallyStartT: number;
  lastStrikeT: number;
  decidedAtT: number;
  gapS: number;
  strikes: number;
  proposedWinner: LiveTrackId | null;
  confidence: number;
  recommendation: LiveRecommendation;
  trigger: string;
  factors: Record<string, number>;
  ceiling: number;
  ceilingSampleSize: number;
  why: string;
}

/**
 * Which tracker identity is which player.
 *
 * One field, not two, so an inconsistent binding cannot be represented. The
 * tracker calls the leftmost player at first sight "A" and has no idea who
 * that is; a human has to say, and has to be able to change their mind,
 * because trackers swap.
 */
export interface TrackBinding {
  aIs: Side;
}

export const DEFAULT_TRACK_BINDING: TrackBinding = { aIs: "A" };

export function sideForTrack(track: LiveTrackId, binding: TrackBinding): Side {
  return track === "A" ? binding.aIs : OTHER_SIDE[binding.aIs];
}

export function flipBinding(binding: TrackBinding): TrackBinding {
  return { aIs: OTHER_SIDE[binding.aIs] };
}

/**
 * A rally end, expressed in the referee's own terms. Still not a decision:
 * `winner` is who the detector thinks struck last, and `recommendation` says
 * how much of the screen should be given to doubting it.
 */
export interface RallyProposal {
  winner: Side | null;
  confidence: number;
  recommendation: LiveRecommendation;
  /** A sentence for the human, straight from the engine. */
  why: string;
  gapS: number;
  strikes: number;
  /** The measured accuracy ceiling the confidence can never exceed. */
  ceiling: number;
  lastStrikeT: number;
  decidedAtT: number;
  /** Wall clock at which this reached JS, for ordering against manual taps. */
  at: number;
}

/** Pure: a native rally-end event in the referee's terms. */
export function toProposal(
  event: LiveRallyEnded,
  binding: TrackBinding,
  now: number = Date.now(),
): RallyProposal {
  return {
    winner: event.proposedWinner === null ? null : sideForTrack(event.proposedWinner, binding),
    confidence: event.confidence,
    recommendation: event.recommendation,
    why: event.why,
    gapS: event.gapS,
    strikes: event.strikes,
    ceiling: event.ceiling,
    lastStrikeT: event.lastStrikeT,
    decidedAtT: event.decidedAtT,
    at: now,
  };
}

// ---------------------------------------------------------------------------
// Bridge narrowing — everything below treats the native side as untrusted
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function trackId(value: unknown): LiveTrackId | null {
  return value === "A" || value === "B" ? value : null;
}

const SESSION_STATES: readonly LiveSessionState[] = [
  "idle",
  "starting",
  "running",
  "stopped",
  "failed",
];

const PROBLEMS: readonly LiveSessionProblem[] = [
  "camera-denied",
  "microphone-denied",
  "no-camera",
  "configuration-failed",
  "interrupted",
];

const THERMAL: readonly LiveThermalState[] = ["nominal", "fair", "serious", "critical"];

const PERMISSION_STATES: readonly LivePermissionState[] = [
  "granted",
  "denied",
  "restricted",
  "undetermined",
];

const RECOMMENDATIONS: readonly LiveRecommendation[] = ["confirm", "propose", "ask"];

export function parseLiveStatus(value: unknown): LiveStatus | null {
  if (!isRecord(value)) return null;
  const problem = typeof value.problem === "string" ? value.problem : null;
  return {
    state: oneOf(value.state, SESSION_STATES, "idle"),
    cameraAuthorized: bool(value.cameraAuthorized),
    microphoneAuthorized: bool(value.microphoneAuthorized),
    detectionAvailable: bool(value.detectionAvailable),
    courtCalibrated: bool(value.courtCalibrated),
    problem:
      problem !== null && (PROBLEMS as readonly string[]).includes(problem)
        ? (problem as LiveSessionProblem)
        : null,
    thermalState: oneOf(value.thermalState, THERMAL, "nominal"),
    poseHz: num(value.poseHz),
    framesProcessed: num(value.framesProcessed),
    framesSkipped: num(value.framesSkipped),
    poseFailures: num(value.poseFailures),
  };
}

export function parseLivePermissions(value: unknown): LivePermissions {
  const record = isRecord(value) ? value : {};
  return {
    camera: oneOf(record.camera, PERMISSION_STATES, "undetermined"),
    microphone: oneOf(record.microphone, PERMISSION_STATES, "undetermined"),
  };
}

export function parseRallyStarted(value: unknown): LiveRallyStarted | null {
  if (!isRecord(value)) return null;
  const striker = trackId(value.firstStriker);
  if (striker === null) return null;
  return { t: num(value.t), firstStriker: striker };
}

export function parseStrike(value: unknown): LiveStrike | null {
  if (!isRecord(value)) return null;
  const striker = trackId(value.striker);
  if (striker === null) return null;
  return {
    t: num(value.t),
    striker,
    peak: num(value.peak),
    margin: num(value.margin),
    fromWrist: bool(value.fromWrist),
    indexInRally: num(value.indexInRally, 1),
    gateWarm: bool(value.gateWarm),
  };
}

/**
 * Narrow a rally-end event.
 *
 * The confidence is clamped into [0, ceiling] here as well as on the native
 * side. That is not paranoia about the bridge: it is the one invariant this
 * whole feature rests on — a proposal must never present as more certain than
 * the heuristic behind it was measured to be, whatever a future native change
 * or an older installed binary sends.
 */
export function parseRallyEnded(value: unknown): LiveRallyEnded | null {
  if (!isRecord(value)) return null;
  const ceiling = num(value.ceiling, 0.727);
  const confidence = Math.min(Math.max(num(value.confidence), 0), ceiling);
  const factors: Record<string, number> = {};
  if (isRecord(value.factors)) {
    for (const [key, raw] of Object.entries(value.factors)) {
      if (typeof raw === "number" && Number.isFinite(raw)) factors[key] = raw;
    }
  }
  return {
    rallyStartT: num(value.rallyStartT),
    lastStrikeT: num(value.lastStrikeT),
    decidedAtT: num(value.decidedAtT),
    gapS: num(value.gapS),
    strikes: num(value.strikes),
    proposedWinner: trackId(value.proposedWinner),
    confidence,
    recommendation: oneOf(value.recommendation, RECOMMENDATIONS, "ask"),
    trigger: typeof value.trigger === "string" ? value.trigger : "silence",
    factors,
    ceiling,
    ceilingSampleSize: num(value.ceilingSampleSize, 11),
    why: typeof value.why === "string" ? value.why : "",
  };
}

// ---------------------------------------------------------------------------
// Loading the native half
// ---------------------------------------------------------------------------

export interface EventSubscription {
  remove(): void;
}

/** The native contract. Loose types: the bridge is a boundary. */
export interface LiveRefereeModule {
  liveRefereePermissions(): unknown;
  requestLiveRefereePermissions(): Promise<unknown>;
  startLiveReferee(cornersJson: string, tuningJson: string): Promise<unknown>;
  stopLiveReferee(): Promise<unknown>;
  liveRefereeStatus(): unknown;
  addListener(eventName: string, listener: (event: unknown) => void): unknown;
  /** Added alongside the live session; older binaries may not have it. */
  refreshLiveRefereeOrientation?(): void;
  /** Returns the preview component, or null when the view is not registered. */
  getLivePreviewComponent?(): unknown;
}

export type LiveRefereeLoader = () => unknown;

const defaultLoader: LiveRefereeLoader = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("racquet-analyzer") as unknown;

function narrowModule(value: unknown): LiveRefereeModule | null {
  if (!isRecord(value)) return null;
  return typeof value.startLiveReferee === "function" &&
    typeof value.stopLiveReferee === "function" &&
    typeof value.liveRefereePermissions === "function" &&
    typeof value.addListener === "function"
    ? (value as unknown as LiveRefereeModule)
    : null;
}

/**
 * The native live-referee module, or null when this binary has none.
 *
 * Never throws. The whole body is inside the try, including the property
 * reads, because the module's default export resolves the native half behind
 * getters — a build without the Swift half throws on ACCESS, not on require.
 */
export function loadLiveReferee(
  loader: LiveRefereeLoader = defaultLoader,
): LiveRefereeModule | null {
  try {
    const exported = loader();
    const viaDefault = isRecord(exported) ? narrowModule(exported.default) : null;
    return viaDefault ?? narrowModule(exported);
  } catch {
    return null;
  }
}

export function isLiveRefereeAvailable(loader?: LiveRefereeLoader): boolean {
  return loadLiveReferee(loader) !== null;
}

export const LIVE_UNAVAILABLE_MESSAGE =
  "Watching the court isn't available in this build. You can still referee by tapping.";

/** The camera preview component, or null. Never throws. */
export function livePreviewComponent(module: LiveRefereeModule | null = loadLiveReferee()): unknown {
  try {
    if (module === null || typeof module.getLivePreviewComponent !== "function") return null;
    return module.getLivePreviewComponent() ?? null;
  } catch {
    return null;
  }
}

const UNAVAILABLE_STATUS: LiveStatus = {
  state: "failed",
  cameraAuthorized: false,
  microphoneAuthorized: false,
  detectionAvailable: false,
  courtCalibrated: false,
  problem: "configuration-failed",
  thermalState: "nominal",
  poseHz: 0,
  framesProcessed: 0,
  framesSkipped: 0,
  poseFailures: 0,
};

/** Current permissions without prompting. Degrades to "undetermined". */
export function liveRefereePermissions(
  module: LiveRefereeModule | null = loadLiveReferee(),
): LivePermissions {
  try {
    if (module === null) return { camera: "undetermined", microphone: "undetermined" };
    return parseLivePermissions(module.liveRefereePermissions());
  } catch {
    return { camera: "undetermined", microphone: "undetermined" };
  }
}

/** Prompt for camera + microphone. Never rejects. */
export async function requestLivePermissions(
  module: LiveRefereeModule | null = loadLiveReferee(),
): Promise<LivePermissions> {
  try {
    if (module === null) return { camera: "undetermined", microphone: "undetermined" };
    return parseLivePermissions(await module.requestLiveRefereePermissions());
  } catch {
    return { camera: "undetermined", microphone: "undetermined" };
  }
}

export interface StartLiveOptions {
  /** `JSON.stringify(CourtCorners)`, or omitted for an uncalibrated session. */
  cornersJson?: string;
  /** Rally-rule overrides. Venue-sensitive; see the module's LiveRefereeTuning. */
  tuning?: Record<string, number>;
}

/**
 * Start watching. Resolves with a status in every case — a denied camera is a
 * screen state, not an exception, because the human must always be able to go
 * on refereeing by hand.
 */
export async function startLiveReferee(
  options: StartLiveOptions = {},
  module: LiveRefereeModule | null = loadLiveReferee(),
): Promise<LiveStatus> {
  if (module === null) return UNAVAILABLE_STATUS;
  try {
    const raw = await module.startLiveReferee(
      options.cornersJson ?? "",
      options.tuning === undefined ? "" : JSON.stringify(options.tuning),
    );
    return parseLiveStatus(raw) ?? UNAVAILABLE_STATUS;
  } catch {
    return UNAVAILABLE_STATUS;
  }
}

export async function stopLiveReferee(
  module: LiveRefereeModule | null = loadLiveReferee(),
): Promise<LiveStatus> {
  if (module === null) return { ...UNAVAILABLE_STATUS, state: "stopped" };
  try {
    const raw = await module.stopLiveReferee();
    return parseLiveStatus(raw) ?? { ...UNAVAILABLE_STATUS, state: "stopped" };
  } catch {
    return { ...UNAVAILABLE_STATUS, state: "stopped" };
  }
}

/** Re-apply the capture rotation after the device turns. Never throws. */
export function refreshLiveOrientation(
  module: LiveRefereeModule | null = loadLiveReferee(),
): void {
  try {
    module?.refreshLiveRefereeOrientation?.();
  } catch {
    // An older binary without the method, or a session that is not running.
  }
}

export interface LiveRefereeHandlers {
  onStatus?: (status: LiveStatus) => void;
  onRallyStarted?: (event: LiveRallyStarted) => void;
  onStrike?: (event: LiveStrike) => void;
  onRallyEnded?: (event: LiveRallyEnded) => void;
}

function narrowSubscription(value: unknown): EventSubscription {
  return isRecord(value) && typeof value.remove === "function"
    ? (value as unknown as EventSubscription)
    : { remove: () => {} };
}

/**
 * Subscribe to the live stream. Returns an unsubscribe function that is always
 * safe to call, including when nothing was ever subscribed.
 *
 * Malformed payloads are DROPPED rather than forwarded: a rally end the app
 * cannot read is not a rally end it should announce.
 */
export function subscribeLiveReferee(
  handlers: LiveRefereeHandlers,
  module: LiveRefereeModule | null = loadLiveReferee(),
): () => void {
  if (module === null) return () => {};
  const subscriptions: EventSubscription[] = [];
  const listen = (name: string, handle: (event: unknown) => void): void => {
    try {
      subscriptions.push(narrowSubscription(module.addListener(name, handle)));
    } catch {
      // One unsupported event name must not cost the others.
    }
  };

  listen("liveRefereeStatus", (event) => {
    const status = parseLiveStatus(event);
    if (status !== null) handlers.onStatus?.(status);
  });
  listen("liveRallyStarted", (event) => {
    const parsed = parseRallyStarted(event);
    if (parsed !== null) handlers.onRallyStarted?.(parsed);
  });
  listen("liveStrike", (event) => {
    const parsed = parseStrike(event);
    if (parsed !== null) handlers.onStrike?.(parsed);
  });
  listen("liveRallyEnded", (event) => {
    const parsed = parseRallyEnded(event);
    if (parsed !== null) handlers.onRallyEnded?.(parsed);
  });

  return () => {
    for (const subscription of subscriptions) {
      try {
        subscription.remove();
      } catch {
        // Already gone.
      }
    }
    subscriptions.length = 0;
  };
}
