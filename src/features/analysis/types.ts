/**
 * Match-analysis domain types — the shared `analysis.json` contract
 * (schemaVersion 1) between the offline pipeline (`analysis/` at the repo
 * root) and this feature. Pure — no Expo or React Native imports — so the
 * parse helper unit-tests on Node and the pipeline can treat this file as the
 * schema reference.
 *
 * Parsing is defensive in the features/recording metadata.ts style: an
 * analysis file comes off disk, so every field is narrowed from `unknown`.
 * Structural breakage (wrong version, malformed player, heatmap size mismatch)
 * yields `null` — the screen shows its "not available" state — while small
 * numeric drift (a coverage value of 1.02, a percent of 100.4) is clamped
 * rather than fatal.
 */

/** Court quadrants of the 2x2 placement grid; names are the contract's cell keys. */
export const COURT_CELLS = ["frontLeft", "frontRight", "backLeft", "backRight"] as const;

export type CourtCell = (typeof COURT_CELLS)[number];

export const PLAYER_IDS = ["A", "B"] as const;

export type PlayerId = (typeof PLAYER_IDS)[number];

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
}

export interface AnalysisQuality {
  framesAnalyzed: number;
  bothPlayersDetectedPct: number;
  audioAvailable: boolean;
  notes: string[];
}

export interface MatchAnalysis {
  /** Bump on shape changes; `parseAnalysis` rejects unknown versions. */
  schemaVersion: 1;
  video: AnalysisVideo;
  court: CourtGrid;
  players: PlayerAnalysis[];
  rallies: RallyStats;
  shots: ShotEvent[];
  quality: AnalysisQuality;
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
    shots.push({ tSec, player, cell });
  }
  return shots;
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

export function parseAnalysis(raw: string): MatchAnalysis | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  // Only schema v1 is readable; a future v2 file is rejected, not misread.
  if (data.schemaVersion !== 1) return null;

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

  return { schemaVersion: 1, video, court, players, rallies, shots, quality };
}
