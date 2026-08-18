/**
 * The `analysis.json` contract — ported from the Expo app's
 * `src/features/analysis/types.ts`, which is the authoritative schema for
 * versions 1 and 2. This file is a MIRROR, not a fork: the shapes, the
 * narrowing rules and the "what counts as fatal" decisions are the app's, so
 * a payload that renders in the app renders here and vice versa. If the app's
 * copy changes, this one changes with it.
 *
 * The parsing discipline is the load-bearing part. An analysis arrives over
 * the wire from a server we do not control (or off disk, for the demo), so
 * every field is narrowed from `unknown`. Structural breakage (wrong version,
 * malformed player, heatmap size mismatch) yields `null` and the page shows
 * its "couldn't read this" state; small numeric drift (a coverage of 1.02) is
 * clamped rather than fatal; auxiliary detail (one bad shot, one bad pose)
 * is dropped on its own. A malformed payload must never white-screen the site.
 *
 * schemaVersion 2 is PURELY ADDITIVE over 1: pose `tracks` for the video
 * overlay, plus `type`/`typeConfidence` per shot. Both parse — a v1 file just
 * yields no skeleton and no shot types, which the UI treats as "absent".
 */

/** Court quadrants of the 2x2 placement grid; names are the contract's cell keys. */
export const COURT_CELLS = ["frontLeft", "frontRight", "backLeft", "backRight"] as const;

export type CourtCell = (typeof COURT_CELLS)[number];

export const PLAYER_IDS = ["A", "B"] as const;

export type PlayerId = (typeof PLAYER_IDS)[number];

/**
 * Shot classes the pipeline may assign (schema v2). There is deliberately no
 * "lob": with no ball tracking a lob and a drive look identical, and a
 * confidently-wrong label is worse than none — those come back as "unknown".
 */
export const SHOT_TYPES = [
  "serve",
  "drive",
  "crossCourt",
  "drop",
  "boast",
  "volley",
  "unknown",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

/**
 * COCO keypoint order. A pose's `k` array is these 17 names in this order,
 * each as an [x, y, conf] triplet, so the index of a name here IS its triplet
 * index in the payload.
 */
export const POSE_KEYPOINT_NAMES = [
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
] as const;

export type PoseKeypointName = (typeof POSE_KEYPOINT_NAMES)[number];

export const POSE_KEYPOINT_COUNT = POSE_KEYPOINT_NAMES.length;

/** Flattened length of one pose: 17 keypoints x [x, y, conf]. */
export const POSE_VALUE_COUNT = POSE_KEYPOINT_COUNT * 3;

export interface AnalysisVideo {
  source: string;
  license: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
}

export interface CourtGrid {
  gridRows: number;
  gridCols: number;
}

/** Shot counts per court quadrant. */
export type Placement = Record<CourtCell, number>;

export interface CoverageHeatmap {
  rows: number;
  cols: number;
  /** Flat row-major, row 0 = front wall; each value normalized 0..1. */
  values: number[];
}

export interface Predictability {
  /** 0..1 — 1 means fully predictable shot selection. */
  score: number;
  entropyBits: number;
  maxEntropyBits: number;
  /** Machine cell names, e.g. "backLeft -> frontRight (41%)" — prettify via format.ts. */
  topPattern: string;
}

export interface PlayerAnalysis {
  id: PlayerId;
  label: string;
  shots: number;
  placement: Placement;
  coverageHeatmap: CoverageHeatmap;
  /** Percent (0..100) of sampled frames within 1.5 m of the T. */
  tTimePct: number;
  predictability: Predictability;
}

export interface RallyStats {
  count: number;
  avgShotsPerRally: number;
  longestRally: number;
}

export interface ShotEvent {
  tSec: number;
  player: PlayerId;
  cell: CourtCell;
  /** v2 only; absent on v1 files and whenever the writer could not classify. */
  type?: ShotType;
  /** 0..1. Absent when `type` is. */
  typeConfidence?: number;
}

/** One player's pose at a sampled instant. */
export interface TrackPose {
  id: PlayerId;
  /**
   * POSE_VALUE_COUNT numbers: 17 x [x, y, conf]. x/y are normalized 0..1
   * against the ANALYSED frame (`video.width`/`video.height`), origin
   * top-left, so the overlay can scale them onto any rendered size.
   */
  k: number[];
}

/** A sampled instant of the pose overlay (~8 Hz, not every frame). */
export interface TrackFrame {
  /** Seconds from video start, on the same timeline the player plays. */
  t: number;
  /** Players confidently detected at `t` — legitimately 0, 1 or 2 entries. */
  p: TrackPose[];
}

export interface AnalysisQuality {
  framesAnalyzed: number;
  bothPlayersDetectedPct: number;
  audioAvailable: boolean;
  notes: string[];
}

export const SCHEMA_VERSIONS = [1, 2] as const;

export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];

export interface MatchAnalysis {
  /** Bump on shape changes; `parseAnalysis` rejects versions it has no reader for. */
  schemaVersion: SchemaVersion;
  video: AnalysisVideo;
  court: CourtGrid;
  players: PlayerAnalysis[];
  rallies: RallyStats;
  shots: ShotEvent[];
  quality: AnalysisQuality;
  /** v2 pose samples, ascending by `t`. Absent means "no skeleton to draw". */
  tracks?: TrackFrame[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finite non-negative number, or null. */
function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Finite number clamped into 0..max, or null when it is not a number at all. */
function asClamped(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, value));
}

function asPlayerId(value: unknown): PlayerId | null {
  return typeof value === "string" && (PLAYER_IDS as readonly string[]).includes(value)
    ? (value as PlayerId)
    : null;
}

function asCell(value: unknown): CourtCell | null {
  return typeof value === "string" && (COURT_CELLS as readonly string[]).includes(value)
    ? (value as CourtCell)
    : null;
}

function asShotType(value: unknown): ShotType | null {
  return typeof value === "string" && (SHOT_TYPES as readonly string[]).includes(value)
    ? (value as ShotType)
    : null;
}

function asSchemaVersion(value: unknown): SchemaVersion | null {
  return (SCHEMA_VERSIONS as readonly unknown[]).includes(value) ? (value as SchemaVersion) : null;
}

function parseVideo(value: unknown): AnalysisVideo | null {
  if (!isRecord(value)) return null;
  if (typeof value.source !== "string" || typeof value.license !== "string") return null;
  const durationSec = asCount(value.durationSec);
  const fps = asCount(value.fps);
  const width = asCount(value.width);
  const height = asCount(value.height);
  if (durationSec === null || fps === null || width === null || height === null) return null;
  return { source: value.source, license: value.license, durationSec, fps, width, height };
}

function parseCourt(value: unknown): CourtGrid | null {
  if (!isRecord(value)) return null;
  const gridRows = asCount(value.gridRows);
  const gridCols = asCount(value.gridCols);
  if (gridRows === null || gridCols === null || gridRows < 1 || gridCols < 1) return null;
  return { gridRows, gridCols };
}

function parsePlacement(value: unknown): Placement | null {
  if (!isRecord(value)) return null;
  const placement = {} as Placement;
  for (const cell of COURT_CELLS) {
    const count = asCount(value[cell]);
    if (count === null) return null;
    placement[cell] = count;
  }
  return placement;
}

function parseHeatmap(value: unknown): CoverageHeatmap | null {
  if (!isRecord(value)) return null;
  const rows = asCount(value.rows);
  const cols = asCount(value.cols);
  if (rows === null || cols === null || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    return null;
  }
  if (rows < 1 || cols < 1) return null;
  // The grid must be exactly rows x cols — a short array would silently shift
  // every row after the gap, so a size mismatch invalidates the heatmap.
  if (!Array.isArray(value.values) || value.values.length !== rows * cols) return null;
  const values: number[] = [];
  for (const item of value.values) {
    const clamped = asClamped(item, 1);
    if (clamped === null) return null;
    values.push(clamped);
  }
  return { rows, cols, values };
}

function parsePredictability(value: unknown): Predictability | null {
  if (!isRecord(value)) return null;
  const score = asClamped(value.score, 1);
  const entropyBits = asCount(value.entropyBits);
  const maxEntropyBits = asCount(value.maxEntropyBits);
  if (score === null || entropyBits === null || maxEntropyBits === null) return null;
  if (typeof value.topPattern !== "string") return null;
  return { score, entropyBits, maxEntropyBits, topPattern: value.topPattern };
}

function parsePlayer(value: unknown): PlayerAnalysis | null {
  if (!isRecord(value)) return null;
  const id = asPlayerId(value.id);
  if (id === null) return null;
  const shots = asCount(value.shots);
  const placement = parsePlacement(value.placement);
  const coverageHeatmap = parseHeatmap(value.coverageHeatmap);
  const tTimePct = asClamped(value.tTimePct, 100);
  const predictability = parsePredictability(value.predictability);
  if (
    shots === null ||
    placement === null ||
    coverageHeatmap === null ||
    tTimePct === null ||
    predictability === null
  ) {
    return null;
  }
  // A missing label degrades to the player id rather than invalidating the file.
  const label =
    typeof value.label === "string" && value.label.length > 0 ? value.label : `Player ${id}`;
  return { id, label, shots, placement, coverageHeatmap, tTimePct, predictability };
}

function parseRallies(value: unknown): RallyStats | null {
  if (!isRecord(value)) return null;
  const count = asCount(value.count);
  const avgShotsPerRally = asCount(value.avgShotsPerRally);
  const longestRally = asCount(value.longestRally);
  if (count === null || avgShotsPerRally === null || longestRally === null) return null;
  return { count, avgShotsPerRally, longestRally };
}

/** Malformed shot events are skipped, not fatal — they are auxiliary detail. */
function parseShots(value: unknown): ShotEvent[] | null {
  if (!Array.isArray(value)) return null;
  const shots: ShotEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const tSec = asCount(item.tSec);
    const player = asPlayerId(item.player);
    const cell = asCell(item.cell);
    if (tSec === null || player === null || cell === null) continue;
    const shot: ShotEvent = { tSec, player, cell };
    // An unreadable class drops to "no label" rather than sinking the shot —
    // where it landed is still worth showing. A confidence without a class is
    // meaningless, so the two only ever travel together.
    const shotType = asShotType(item.type);
    if (shotType !== null) {
      shot.type = shotType;
      const confidence = asClamped(item.typeConfidence, 1);
      if (confidence !== null) shot.typeConfidence = confidence;
    }
    shots.push(shot);
  }
  return shots;
}

/**
 * One pose, or null. The triplet layout is load-bearing for the overlay — a
 * short or long array would silently shift every joint after the gap — so the
 * length is exact, and a confidence outside 0..1 means the writer is on a
 * different contract, not that it drifted, so the whole detection is dropped.
 */
function parseKeypoints(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== POSE_VALUE_COUNT) return null;
  const keypoints: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    if (index % 3 === 2 && (item < 0 || item > 1)) return null;
    keypoints.push(item);
  }
  return keypoints;
}

function parseTrackFrame(value: unknown): TrackFrame | null {
  if (!isRecord(value)) return null;
  const t = asCount(value.t);
  if (t === null || !Array.isArray(value.p)) return null;
  const poses: TrackPose[] = [];
  for (const item of value.p) {
    if (!isRecord(item)) continue;
    const id = asPlayerId(item.id);
    const k = parseKeypoints(item.k);
    // One broken detection drops alone: the other player still gets a skeleton.
    if (id === null || k === null) continue;
    if (poses.some((pose) => pose.id === id)) continue;
    poses.push({ id, k });
  }
  // An empty `p` is meaningful — nobody was confidently detected at `t`, so the
  // overlay must clear rather than hold the previous frame's pose.
  return { t, p: poses };
}

/**
 * Absent, non-array, or wholly unusable tracks read as "no skeleton" (the v1
 * experience) rather than invalidating an otherwise good analysis. Sorted on
 * the way in because the overlay binary-searches for the frame nearest the
 * playhead on every animation tick.
 */
function parseTracks(value: unknown): TrackFrame[] | null {
  if (!Array.isArray(value)) return null;
  const frames: TrackFrame[] = [];
  for (const item of value) {
    const frame = parseTrackFrame(item);
    if (frame !== null) frames.push(frame);
  }
  if (frames.length === 0) return null;
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

function parseQuality(value: unknown): AnalysisQuality | null {
  if (!isRecord(value)) return null;
  const framesAnalyzed = asCount(value.framesAnalyzed);
  const bothPlayersDetectedPct = asClamped(value.bothPlayersDetectedPct, 100);
  if (framesAnalyzed === null || bothPlayersDetectedPct === null) return null;
  if (typeof value.audioAvailable !== "boolean") return null;
  // Notes are commentary: keep the strings, drop anything else.
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === "string")
    : [];
  return { framesAnalyzed, bothPlayersDetectedPct, audioAvailable: value.audioAvailable, notes };
}

/**
 * Narrow an already-decoded payload. Split out from `parseAnalysis` because
 * `fetch` hands back a parsed object via `.json()` and re-stringifying two
 * megabytes of pose data just to re-parse it is waste.
 */
export function parseAnalysisValue(data: unknown): MatchAnalysis | null {
  if (!isRecord(data)) return null;

  // v2 is additive over v1, so one reader serves both; anything else is
  // rejected rather than misread.
  const schemaVersion = asSchemaVersion(data.schemaVersion);
  if (schemaVersion === null) return null;

  const video = parseVideo(data.video);
  const court = parseCourt(data.court);
  const rallies = parseRallies(data.rallies);
  const shots = parseShots(data.shots);
  const quality = parseQuality(data.quality);
  if (video === null || court === null || rallies === null || shots === null || quality === null) {
    return null;
  }

  if (!Array.isArray(data.players) || data.players.length === 0) return null;
  const players: PlayerAnalysis[] = [];
  for (const item of data.players) {
    const player = parsePlayer(item);
    // One broken player invalidates the file — half a comparison misleads.
    if (player === null) return null;
    players.push(player);
  }

  const analysis: MatchAnalysis = {
    schemaVersion,
    video,
    court,
    players,
    rallies,
    shots,
    quality,
  };
  const tracks = parseTracks(data.tracks);
  if (tracks !== null) analysis.tracks = tracks;
  return analysis;
}

export function parseAnalysis(raw: string): MatchAnalysis | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseAnalysisValue(data);
}
