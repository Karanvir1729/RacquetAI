/**
 * Player profiles — the people IN the footage, as opposed to `lib/playerProfile`
 * which is the signed-in user's own coaching profile.
 *
 * A profile is nothing more than a name plus every clip that name was tagged
 * on. Each tag keeps a CLIP SUMMARY: the one side's numbers from that
 * analysis (and the opponent's, for comparison), small enough to live in a
 * database row. The analysis itself stays where it always was — in the
 * browser that ran it, footage and pose track included — so a profile can be
 * read on any machine without ever moving a match video.
 *
 * This file is the domain only: the shapes, the summary a clip reduces to, and
 * the row narrowing. No I/O (that is store.ts) and no maths over many clips
 * (that is aggregate.ts), so the rules are testable without a database and
 * the tests run under jest with relative imports, like history.ts.
 *
 * Why a summary and not the whole analysis: a schema-v2 file is two megabytes
 * of pose samples; the read-out's numbers are a few kilobytes. Storing what a
 * profile aggregates, and only that, is what keeps "every match you ever
 * tagged" a query instead of a download.
 */
import {
  COURT_CELLS,
  PLAYER_IDS,
  SHOT_TYPES,
  type CourtCell,
  type CoverageHeatmap,
  type MatchAnalysis,
  type Placement,
  type PlayerId,
  type ShotType,
} from "../analysis/types";

export const CLIP_SUMMARY_VERSION = 1 as const;

export const PLAYER_NAME_MAX = 80;
export const PLAYER_NOTES_MAX = 600;
export const CLIP_TITLE_MAX = 200;

export const HANDS = ["right", "left"] as const;
export type Hand = (typeof HANDS)[number];

/** Counts per shot class; zero everywhere for a v1 file that carries no classes. */
export type ShotTypeCounts = Record<ShotType, number>;

/**
 * Consecutive-cell pairs for one player's own shot sequence, keyed in the
 * contract's own pattern grammar — `"backLeft -> frontRight"` — so the
 * aggregate's top pattern prints through the same `prettyPattern` the read-out
 * uses, and so it means the same thing as the per-clip `topPattern`: the
 * share of all of this player's shot-to-next-shot transitions.
 */
export type Transitions = Record<string, number>;

export interface SideSummary {
  /** The analysis' own label — "Player A (lighter shirt)" — kept for the clip list. */
  label: string;
  shots: number;
  placement: Placement;
  /** Present for the tagged side; the opponent's is not kept (nothing reads it). */
  coverage: CoverageHeatmap | null;
  /** Percent (0..100) of sampled frames within 1.5 m of the T. */
  tTimePct: number;
  predictability: { score: number; entropyBits: number; maxEntropyBits: number; topPattern: string };
  shotTypes: ShotTypeCounts;
  /** How many shots carried a class at all — the denominator for the mix. */
  classifiedShots: number;
  transitions: Transitions;
}

export interface ClipSummary {
  v: typeof CLIP_SUMMARY_VERSION;
  schemaVersion: number;
  durationSec: number;
  rallies: { count: number; avgShotsPerRally: number; longestRally: number };
  quality: { framesAnalyzed: number; bothPlayersDetectedPct: number; audioAvailable: boolean };
  me: SideSummary;
  /** Null when the analysis had one player only. */
  opponent: SideSummary | null;
}

export interface Player {
  id: string;
  name: string;
  hand: Hand | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerClip {
  id: string;
  playerId: string;
  /** Which side of the analysis this player was. */
  side: PlayerId;
  title: string;
  /** The analysis job, when there was one — how a read-out finds its own tags. */
  jobId: string | null;
  /** This browser's library id, so the recordings list can link back here. */
  historyId: string | null;
  /** ISO date, YYYY-MM-DD — when the match was played, as the tagger said. */
  playedAt: string;
  durationSec: number;
  shots: number;
  summary: ClipSummary;
  createdAt: string;
}

/** What identifies the clip a read-out is showing, for tagging. */
export interface ClipRef {
  jobId: string | null;
  historyId: string | null;
  title: string;
  /** Default for "played on" — the day it was analysed, unless the tagger says otherwise. */
  playedAt: string;
}

// ---------------------------------------------------------------- summarising

function emptyShotTypes(): ShotTypeCounts {
  const counts = {} as ShotTypeCounts;
  for (const type of SHOT_TYPES) counts[type] = 0;
  return counts;
}

export function patternKey(from: CourtCell, to: CourtCell): string {
  return `${from} -> ${to}`;
}

function summarizeSide(
  analysis: MatchAnalysis,
  side: PlayerId,
  keepCoverage: boolean,
): SideSummary | null {
  const player = analysis.players.find((p) => p.id === side);
  if (player === undefined) return null;

  const shotTypes = emptyShotTypes();
  const transitions: Transitions = {};
  let classifiedShots = 0;
  let previous: CourtCell | null = null;
  for (const shot of analysis.shots) {
    if (shot.player !== side) continue;
    if (shot.type !== undefined) {
      shotTypes[shot.type] += 1;
      classifiedShots += 1;
    }
    if (previous !== null) {
      const key = patternKey(previous, shot.cell);
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
    previous = shot.cell;
  }

  return {
    label: player.label,
    shots: player.shots,
    placement: { ...player.placement },
    coverage: keepCoverage
      ? {
          rows: player.coverageHeatmap.rows,
          cols: player.coverageHeatmap.cols,
          values: [...player.coverageHeatmap.values],
        }
      : null,
    tTimePct: player.tTimePct,
    predictability: { ...player.predictability },
    shotTypes,
    classifiedShots,
    transitions,
  };
}

/**
 * Reduce one analysis to what a profile keeps about one side of it. Null when
 * that side is not in the file — a one-player analysis has no "B" to tag.
 */
export function summarizeClip(analysis: MatchAnalysis, side: PlayerId): ClipSummary | null {
  const me = summarizeSide(analysis, side, true);
  if (me === null) return null;
  const otherSide = PLAYER_IDS.find((id) => id !== side);
  const opponent = otherSide === undefined ? null : summarizeSide(analysis, otherSide, false);
  return {
    v: CLIP_SUMMARY_VERSION,
    schemaVersion: analysis.schemaVersion,
    durationSec: analysis.video.durationSec,
    rallies: { ...analysis.rallies },
    quality: {
      framesAnalyzed: analysis.quality.framesAnalyzed,
      bothPlayersDetectedPct: analysis.quality.bothPlayersDetectedPct,
      audioAvailable: analysis.quality.audioAvailable,
    },
    me,
    opponent,
  };
}

// ------------------------------------------------------------------ narrowing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asClamped(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, value));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asHand(value: unknown): Hand | null {
  return typeof value === "string" && (HANDS as readonly string[]).includes(value)
    ? (value as Hand)
    : null;
}

export function asPlayerId(value: unknown): PlayerId | null {
  return typeof value === "string" && (PLAYER_IDS as readonly string[]).includes(value)
    ? (value as PlayerId)
    : null;
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

function parseCoverage(value: unknown): CoverageHeatmap | null {
  if (!isRecord(value)) return null;
  const rows = asCount(value.rows);
  const cols = asCount(value.cols);
  if (rows === null || cols === null || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    return null;
  }
  if (rows < 1 || cols < 1) return null;
  if (!Array.isArray(value.values) || value.values.length !== rows * cols) return null;
  const values: number[] = [];
  for (const item of value.values) {
    const clamped = asClamped(item, 1);
    if (clamped === null) return null;
    values.push(clamped);
  }
  return { rows, cols, values };
}

function parseShotTypes(value: unknown): ShotTypeCounts {
  // Missing or partial classes read as zero rather than invalidating the clip:
  // a v1 file legitimately has none.
  const counts = emptyShotTypes();
  if (!isRecord(value)) return counts;
  for (const type of SHOT_TYPES) {
    const count = asCount(value[type]);
    if (count !== null) counts[type] = count;
  }
  return counts;
}

function parseTransitions(value: unknown): Transitions {
  const transitions: Transitions = {};
  if (!isRecord(value)) return transitions;
  const cells = COURT_CELLS as readonly string[];
  for (const [key, raw] of Object.entries(value)) {
    const parts = key.split(" -> ");
    if (parts.length !== 2 || !cells.includes(parts[0] ?? "") || !cells.includes(parts[1] ?? "")) {
      continue;
    }
    const count = asCount(raw);
    if (count !== null && count > 0) transitions[key] = count;
  }
  return transitions;
}

function parseSide(value: unknown): SideSummary | null {
  if (!isRecord(value)) return null;
  const shots = asCount(value.shots);
  const placement = parsePlacement(value.placement);
  const tTimePct = asClamped(value.tTimePct, 100);
  if (shots === null || placement === null || tTimePct === null) return null;
  if (!isRecord(value.predictability)) return null;
  const score = asClamped(value.predictability.score, 1);
  const entropyBits = asCount(value.predictability.entropyBits);
  const maxEntropyBits = asCount(value.predictability.maxEntropyBits);
  if (score === null || entropyBits === null || maxEntropyBits === null) return null;
  const shotTypes = parseShotTypes(value.shotTypes);
  const classified = asCount(value.classifiedShots);
  return {
    label: asText(value.label) || "Player",
    shots,
    placement,
    // A malformed heatmap drops alone — the profile still has its numbers.
    coverage: parseCoverage(value.coverage),
    tTimePct,
    predictability: {
      score,
      entropyBits,
      maxEntropyBits,
      topPattern: asText(value.predictability.topPattern),
    },
    shotTypes,
    classifiedShots:
      classified ?? SHOT_TYPES.reduce((sum, type) => sum + shotTypes[type], 0),
    transitions: parseTransitions(value.transitions),
  };
}

/**
 * Narrow a stored summary. Structural breakage yields null and the clip is
 * left out of the profile; drift in auxiliary detail (classes, heatmap,
 * transitions) degrades on its own. A bad row must never take the page down.
 */
export function parseClipSummary(value: unknown): ClipSummary | null {
  if (!isRecord(value)) return null;
  if (value.v !== CLIP_SUMMARY_VERSION) return null;
  const durationSec = asCount(value.durationSec);
  const schemaVersion = asCount(value.schemaVersion);
  if (durationSec === null || schemaVersion === null) return null;
  if (!isRecord(value.rallies) || !isRecord(value.quality)) return null;
  const count = asCount(value.rallies.count);
  const avgShotsPerRally = asCount(value.rallies.avgShotsPerRally);
  const longestRally = asCount(value.rallies.longestRally);
  if (count === null || avgShotsPerRally === null || longestRally === null) return null;
  const framesAnalyzed = asCount(value.quality.framesAnalyzed);
  const bothPlayersDetectedPct = asClamped(value.quality.bothPlayersDetectedPct, 100);
  if (framesAnalyzed === null || bothPlayersDetectedPct === null) return null;
  const me = parseSide(value.me);
  if (me === null) return null;
  return {
    v: CLIP_SUMMARY_VERSION,
    schemaVersion,
    durationSec,
    rallies: { count, avgShotsPerRally, longestRally },
    quality: {
      framesAnalyzed,
      bothPlayersDetectedPct,
      audioAvailable: value.quality.audioAvailable === true,
    },
    me,
    opponent: value.opponent === null || value.opponent === undefined ? null : parseSide(value.opponent),
  };
}

function asIsoStamp(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : "";
}

/** `players` row → Player, or null when the row is unusable (no id / name). */
export function fromPlayerRow(row: unknown): Player | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || row.id.length === 0) return null;
  const name = asText(row.name).trim();
  if (name.length === 0) return null;
  return {
    id: row.id,
    name,
    hand: asHand(row.hand),
    notes: asText(row.notes),
    createdAt: asIsoStamp(row.created_at),
    updatedAt: asIsoStamp(row.updated_at),
  };
}

/** `player_clips` row → PlayerClip, or null when the summary will not parse. */
export function fromClipRow(row: unknown): PlayerClip | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string" || typeof row.player_id !== "string") return null;
  const side = asPlayerId(row.side);
  const summary = parseClipSummary(row.summary);
  if (side === null || summary === null) return null;
  const playedAt = typeof row.played_at === "string" ? row.played_at.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedAt)) return null;
  return {
    id: row.id,
    playerId: row.player_id,
    side,
    title: asText(row.title),
    jobId: typeof row.job_id === "string" && row.job_id.length > 0 ? row.job_id : null,
    historyId: typeof row.history_id === "string" && row.history_id.length > 0 ? row.history_id : null,
    playedAt,
    durationSec: asCount(row.duration_sec) ?? summary.durationSec,
    shots: asCount(row.shots) ?? summary.me.shots,
    summary,
    createdAt: asIsoStamp(row.created_at),
  };
}

// ----------------------------------------------------------------- validation

/** Null when the name will do; else the message to show beside the field. */
export function validatePlayerName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give the player a name.";
  if (trimmed.length > PLAYER_NAME_MAX) return `${PLAYER_NAME_MAX} characters or fewer.`;
  return null;
}

export function validateNotes(notes: string): string | null {
  return notes.length > PLAYER_NOTES_MAX ? `${PLAYER_NOTES_MAX} characters or fewer.` : null;
}

/** YYYY-MM-DD for a Date, in local time — the calendar is the tagger's. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && isoDay(parsed) === value;
}
