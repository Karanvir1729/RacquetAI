/**
 * Many clips → one profile. Pure maths, no I/O, relative imports (jest runs it).
 * Shared with the web through web/src/players/aggregate.ts, a re-export shim —
 * one copy of the rules, so a profile's numbers and notes are the same on the
 * phone and in the browser (see shape.ts's header for why it lives here).
 *
 * The guiding rule is the product's: only claim what the pipeline measured,
 * and pool the measurements the way the pipeline made them. Predictability is
 * therefore NOT an average of per-clip scores — it is the same entropy-rate
 * formula `analyze.py` uses, run over the pooled transition matrix, so a
 * profile's score means exactly what a single read-out's does. T-time and
 * coverage are time-weighted (they are "share of frames"); rally length is
 * rally-weighted; the placement and shot-mix are plain sums.
 *
 * What the numbers mean matters as much as the maths. "Placement" is the
 * pipeline's retrieval proxy: a shot's cell is where the OPPONENT was when
 * they played the next ball — a stand-in for where the shot went, because
 * there is no ball tracking. So a placement tendency reads "their shots went
 * short", never "they stood at the front". Shot DETECTION was audited at ~63%
 * precision on club footage (some phantom shots, some misses); shot CLASSES
 * (drive / cross / drop…) are read from body pose alone and are unaudited —
 * indicative only.
 *
 * Scouting notes are rule-based sentences over those numbers, each tagged with
 * what it rests on: player POSITION and timing (coverage, the T, where the
 * ball was retrieved — measured), or shot CLASSES (indicative). The
 * thresholds are deliberately conservative and the notes fall silent under a
 * minimum sample rather than extrapolate.
 */
import {
  COURT_CELLS,
  SHOT_TYPES,
  type CourtCell,
  type CoverageHeatmap,
  type Placement,
} from "../analysis/types";
import type { PlayerClip, ShotTypeCounts, Transitions } from "./shape";

export interface TrendPoint {
  clipId: string;
  playedAt: string;
  title: string;
  tTimePct: number;
  predictability: number;
  shots: number;
  durationSec: number;
  avgRallyShots: number;
}

/** Me minus the players across the court, over the clips that had an opponent. */
export interface VersusOpponents {
  clips: number;
  tTimeDelta: number | null;
  predictabilityDelta: number | null;
  frontShareDelta: number | null;
}

export interface TopPattern {
  /** Contract grammar: "backLeft -> frontRight" — print via prettyPattern. */
  pattern: string;
  count: number;
  /** Of all this player's shot-to-next-shot transitions. */
  share: number;
}

export interface ProfileStats {
  recordings: number;
  totalSec: number;
  totalShots: number;
  totalRallies: number;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  /** Time-weighted mean, percent. Null with no recordings. */
  tTimePct: number | null;
  /** 0..1 over the pooled transition matrix; null until there are transitions. */
  predictability: number | null;
  topPatterns: TopPattern[];
  transitionsTotal: number;
  avgRallyShots: number | null;
  longestRally: number;
  placement: Placement;
  placementTotal: number;
  frontShare: number | null;
  leftShare: number | null;
  shotTypes: ShotTypeCounts;
  classifiedShots: number;
  /** Time-weighted mean over clips sharing the commonest grid size; null if none. */
  coverage: CoverageHeatmap | null;
  /** Time-weighted "both players detected" share, percent. */
  qualityPct: number | null;
  versus: VersusOpponents;
  /** Chronological, oldest first. */
  trend: TrendPoint[];
}

const MAX_ENTROPY_BITS = 2; // log2 of four cells — the pipeline's Hmax.

function emptyShotTypes(): ShotTypeCounts {
  const counts = {} as ShotTypeCounts;
  for (const type of SHOT_TYPES) counts[type] = 0;
  return counts;
}

function emptyPlacement(): Placement {
  const placement = {} as Placement;
  for (const cell of COURT_CELLS) placement[cell] = 0;
  return placement;
}

/** Oldest first; ties by when the tag was made, so a re-tag keeps its place. */
export function sortChronologically(clips: readonly PlayerClip[]): PlayerClip[] {
  return [...clips].sort(
    (a, b) => a.playedAt.localeCompare(b.playedAt) || a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * `1 - H/Hmax` over a transition matrix, H being the entropy RATE
 * (row-weighted conditional entropy) — `entropy_predictability` in
 * analyze.py, transcribed. Null when there is nothing to measure.
 */
export function predictabilityFromTransitions(transitions: Transitions): number | null {
  const total = Object.values(transitions).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return null;
  const rowTotals = new Map<string, number>();
  for (const [key, count] of Object.entries(transitions)) {
    const from = key.split(" -> ")[0] ?? key;
    rowTotals.set(from, (rowTotals.get(from) ?? 0) + count);
  }
  let entropy = 0;
  for (const [key, count] of Object.entries(transitions)) {
    const from = key.split(" -> ")[0] ?? key;
    const rowTotal = rowTotals.get(from) ?? count;
    const p = count / rowTotal;
    entropy += (rowTotal / total) * (-p * Math.log2(p));
  }
  const score = 1 - entropy / MAX_ENTROPY_BITS;
  return Math.min(1, Math.max(0, Math.round(score * 1000) / 1000));
}

function placementShares(placement: Placement): {
  total: number;
  front: number | null;
  left: number | null;
} {
  const total = COURT_CELLS.reduce((sum, cell) => sum + placement[cell], 0);
  if (total <= 0) return { total: 0, front: null, left: null };
  return {
    total,
    front: (placement.frontLeft + placement.frontRight) / total,
    left: (placement.frontLeft + placement.backLeft) / total,
  };
}

function weightedMean(pairs: ReadonlyArray<readonly [value: number, weight: number]>): number | null {
  let sum = 0;
  let weights = 0;
  for (const [value, weight] of pairs) {
    if (weight <= 0) continue;
    sum += value * weight;
    weights += weight;
  }
  return weights > 0 ? sum / weights : null;
}

function pooledCoverage(clips: readonly PlayerClip[]): CoverageHeatmap | null {
  // Clips can come from pipeline versions with different grid sizes; averaging
  // across sizes would be meaningless, so the commonest size wins and the rest
  // are left out of the plan (never out of the numbers).
  const sizes = new Map<string, { rows: number; cols: number; weight: number }>();
  for (const clip of clips) {
    const cov = clip.summary.me.coverage;
    if (cov === null) continue;
    const key = `${cov.rows}x${cov.cols}`;
    const entry = sizes.get(key) ?? { rows: cov.rows, cols: cov.cols, weight: 0 };
    entry.weight += Math.max(clip.summary.durationSec, 1);
    sizes.set(key, entry);
  }
  let best: { rows: number; cols: number; weight: number } | null = null;
  for (const entry of sizes.values()) {
    if (best === null || entry.weight > best.weight) best = entry;
  }
  if (best === null) return null;
  const values = new Array<number>(best.rows * best.cols).fill(0);
  let weights = 0;
  for (const clip of clips) {
    const cov = clip.summary.me.coverage;
    if (cov === null || cov.rows !== best.rows || cov.cols !== best.cols) continue;
    const weight = Math.max(clip.summary.durationSec, 1);
    weights += weight;
    for (let index = 0; index < values.length; index += 1) {
      values[index] = (values[index] ?? 0) + (cov.values[index] ?? 0) * weight;
    }
  }
  if (weights <= 0) return null;
  // Per-clip maps are normalised to their busiest cell (= 1). Two maps that
  // peak in different cells average to a map that peaks below 1, which the
  // court plan would paint as "quiet everywhere" — so the pooled map is put
  // back on the same convention before it leaves here.
  const mean = values.map((value) => value / weights);
  const peak = Math.max(...mean, 0);
  return {
    rows: best.rows,
    cols: best.cols,
    values: mean.map((value) => (peak > 0 ? Math.min(1, Math.max(0, value / peak)) : 0)),
  };
}

export function buildProfileStats(input: readonly PlayerClip[]): ProfileStats {
  const clips = sortChronologically(input);
  const placement = emptyPlacement();
  const shotTypes = emptyShotTypes();
  const transitions: Transitions = {};
  let totalSec = 0;
  let totalShots = 0;
  let totalRallies = 0;
  let longestRally = 0;
  let classifiedShots = 0;
  const tTimePairs: Array<readonly [number, number]> = [];
  const rallyPairs: Array<readonly [number, number]> = [];
  const qualityPairs: Array<readonly [number, number]> = [];
  const vsT: Array<readonly [number, number]> = [];
  const vsPred: Array<readonly [number, number]> = [];
  const vsFront: Array<readonly [number, number]> = [];
  let vsClips = 0;
  const trend: TrendPoint[] = [];

  for (const clip of clips) {
    const { summary } = clip;
    const { me, opponent } = summary;
    totalSec += summary.durationSec;
    totalShots += me.shots;
    totalRallies += summary.rallies.count;
    longestRally = Math.max(longestRally, summary.rallies.longestRally);
    classifiedShots += me.classifiedShots;
    for (const cell of COURT_CELLS) placement[cell] += me.placement[cell];
    for (const type of SHOT_TYPES) shotTypes[type] += me.shotTypes[type];
    for (const [key, count] of Object.entries(me.transitions)) {
      transitions[key] = (transitions[key] ?? 0) + count;
    }
    const timeWeight = Math.max(summary.durationSec, 1);
    tTimePairs.push([me.tTimePct, timeWeight]);
    qualityPairs.push([summary.quality.bothPlayersDetectedPct, timeWeight]);
    if (summary.rallies.count > 0) {
      rallyPairs.push([summary.rallies.avgShotsPerRally, summary.rallies.count]);
    }
    if (opponent !== null) {
      vsClips += 1;
      vsT.push([me.tTimePct - opponent.tTimePct, timeWeight]);
      vsPred.push([
        me.predictability.score - opponent.predictability.score,
        Math.max(me.shots + opponent.shots, 1),
      ]);
      const mine = placementShares(me.placement).front;
      const theirs = placementShares(opponent.placement).front;
      if (mine !== null && theirs !== null) vsFront.push([mine - theirs, Math.max(me.shots, 1)]);
    }
    trend.push({
      clipId: clip.id,
      playedAt: clip.playedAt,
      title: clip.title,
      tTimePct: me.tTimePct,
      predictability: me.predictability.score,
      shots: me.shots,
      durationSec: summary.durationSec,
      avgRallyShots: summary.rallies.avgShotsPerRally,
    });
  }

  const transitionsTotal = Object.values(transitions).reduce((sum, count) => sum + count, 0);
  const topPatterns: TopPattern[] = Object.entries(transitions)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([pattern, count]) => ({ pattern, count, share: count / transitionsTotal }));

  const shares = placementShares(placement);
  const first = clips[0];
  const last = clips[clips.length - 1];

  return {
    recordings: clips.length,
    totalSec,
    totalShots,
    totalRallies,
    firstPlayedAt: first?.playedAt ?? null,
    lastPlayedAt: last?.playedAt ?? null,
    tTimePct: weightedMean(tTimePairs),
    predictability: predictabilityFromTransitions(transitions),
    topPatterns,
    transitionsTotal,
    avgRallyShots: weightedMean(rallyPairs),
    longestRally,
    placement,
    placementTotal: shares.total,
    frontShare: shares.front,
    leftShare: shares.left,
    shotTypes,
    classifiedShots,
    coverage: pooledCoverage(clips),
    qualityPct: weightedMean(qualityPairs),
    versus: {
      clips: vsClips,
      tTimeDelta: weightedMean(vsT),
      predictabilityDelta: weightedMean(vsPred),
      frontShareDelta: weightedMean(vsFront),
    },
    trend,
  };
}

// ------------------------------------------------------------ scouting notes

/** What a note rests on. Position/timing is measured; shot classes are unaudited, indicative. */
export type NoteBasis = "position" | "classes";

export interface ScoutingNote {
  id: string;
  title: string;
  detail: string;
  basis: NoteBasis;
}

/** Under this many of the player's own shots the notes say nothing at all. */
export const MIN_SHOTS_FOR_NOTES = 40;
/** Under this many classified shots the class-based notes stay silent. */
export const MIN_CLASSIFIED_FOR_NOTES = 30;

const CELL_WORDS: Record<CourtCell, string> = {
  frontLeft: "front left",
  frontRight: "front right",
  backLeft: "back left",
  backRight: "back right",
};

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function pctPoints(value: number): string {
  return `${Math.round(value)}%`;
}

/** Predictability as the read-out prints it — a percentage, higher = easier to read. */
function predictabilityPct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * The rules. Each threshold is a judgement call written down in one place;
 * the detail line always carries the number the claim rests on, so a reader
 * can disagree with the adjective and keep the measurement.
 */
export function scoutingNotes(stats: ProfileStats): ScoutingNote[] {
  const notes: ScoutingNote[] = [];
  if (stats.totalShots < MIN_SHOTS_FOR_NOTES) return notes;
  const over = `over ${stats.recordings} ${stats.recordings === 1 ? "recording" : "recordings"}`;

  // --- the T ------------------------------------------------------------
  if (stats.tTimePct !== null) {
    const delta = stats.versus.tTimeDelta;
    if (delta !== null && stats.versus.clips > 0 && Math.abs(delta) >= 5) {
      notes.push(
        delta < 0
          ? {
              id: "t-slow",
              title: "Slow back to the T",
              detail: `Within 1.5 m of the T ${pctPoints(stats.tTimePct)} of the time, against ${pctPoints(
                stats.tTimePct - delta,
              )} for the players across the court, ${over}. Pressure that recovery.`,
              basis: "position",
            }
          : {
              id: "t-owns",
              title: "Owns the T",
              detail: `At the T ${pctPoints(stats.tTimePct)} of the time — ${pctPoints(
                Math.abs(delta),
              )} points more than their opponents, ${over}. Expect to be moved.`,
              basis: "position",
            },
      );
    } else if (stats.tTimePct < 20) {
      notes.push({
        id: "t-low",
        title: "Rarely at the T",
        detail: `Within 1.5 m of the T only ${pctPoints(stats.tTimePct)} of the time, ${over}.`,
        basis: "position",
      });
    } else if (stats.tTimePct >= 35) {
      notes.push({
        id: "t-high",
        title: "Holds the T",
        detail: `Within 1.5 m of the T ${pctPoints(stats.tTimePct)} of the time, ${over}.`,
        basis: "position",
      });
    }
  }

  // --- pattern ----------------------------------------------------------
  const top = stats.topPatterns[0];
  if (stats.predictability !== null && stats.transitionsTotal >= 30 && top !== undefined) {
    const [from, to] = top.pattern.split(" -> ") as [CourtCell, CourtCell];
    const fromWord = CELL_WORDS[from] ?? from;
    const toWord = CELL_WORDS[to] ?? to;
    if (stats.predictability >= 0.3 || top.share >= 0.25) {
      notes.push({
        id: "pattern-repeat",
        title: `Repeats a pattern: ${fromWord} → ${toWord}`,
        detail: `${pct(top.share)} of the time a shot to the ${fromWord} was followed by one to the ${toWord}; predictability ${predictabilityPct(
          stats.predictability,
        )} (higher means easier to read), ${over}. Read it and be there early.`,
        basis: "position",
      });
    } else if (stats.predictability <= 0.12) {
      notes.push({
        id: "pattern-varied",
        title: "Hard to read",
        detail: `Predictability ${predictabilityPct(
          stats.predictability,
        )} (higher means easier to read) — no single placement pattern above ${pct(top.share)}, ${over}. Don't guess; cover the middle.`,
        basis: "position",
      });
    }
  }

  // --- depth ------------------------------------------------------------
  if (stats.frontShare !== null && stats.placementTotal >= MIN_SHOTS_FOR_NOTES) {
    if (stats.frontShare <= 0.18) {
      notes.push({
        id: "depth-deep",
        title: "Rarely goes short",
        detail: `Only ${pct(stats.frontShare)} of their shots went to the front court, ${over}. Take the T and wait — or pull them forward yourself.`,
        basis: "position",
      });
    } else if (stats.frontShare >= 0.35) {
      notes.push({
        id: "depth-short",
        title: "Plays the short game",
        detail: `${pct(stats.frontShare)} of their shots went to the front court, ${over}. Expect drops and counter-drops.`,
        basis: "position",
      });
    }
  }

  // --- side -------------------------------------------------------------
  if (stats.leftShare !== null && stats.placementTotal >= MIN_SHOTS_FOR_NOTES) {
    if (stats.leftShare >= 0.62) {
      notes.push({
        id: "side-left",
        title: "Plays to the left",
        detail: `${pct(stats.leftShare)} of their shots went to the left side of the court, ${over}.`,
        basis: "position",
      });
    } else if (stats.leftShare <= 0.38) {
      notes.push({
        id: "side-right",
        title: "Plays to the right",
        detail: `${pct(1 - stats.leftShare)} of their shots went to the right side of the court, ${over}.`,
        basis: "position",
      });
    }
  }

  // Rally length is deliberately NOT a note. The pipeline's rally boundaries
  // come from sound and motion and are unaudited on club footage, where they
  // visibly undercount (a "48-shot average rally" is an artefact, not a
  // tendency) — the number is shown on the profile, but not turned into a
  // claim about the person.

  // --- shot classes (indicative) -------------------------------------------
  if (stats.classifiedShots >= MIN_CLASSIFIED_FOR_NOTES) {
    const share = (type: keyof ShotTypeCounts) => stats.shotTypes[type] / stats.classifiedShots;
    const cross = share("crossCourt");
    const drop = share("drop");
    const boast = share("boast");
    const volley = share("volley");
    if (cross >= 0.35) {
      notes.push({
        id: "class-cross",
        title: "Goes cross-court a lot",
        detail: `${pct(cross)} of classified shots were read as cross-courts, ${over}. Hold the T and volley them.`,
        basis: "classes",
      });
    }
    if (drop >= 0.15) {
      notes.push({
        id: "class-drops",
        title: "Drops often",
        detail: `${pct(drop)} of classified shots were read as drops, ${over}.`,
        basis: "classes",
      });
    } else if (drop <= 0.04) {
      notes.push({
        id: "class-no-drops",
        title: "Almost never drops",
        detail: `${pct(drop)} of classified shots were read as drops, ${over}. The front court is yours to use.`,
        basis: "classes",
      });
    }
    if (boast >= 0.12) {
      notes.push({
        id: "class-boasts",
        title: "Boasts often",
        detail: `${pct(boast)} of classified shots were read as boasts, ${over}. Be ready to move forward off the back wall.`,
        basis: "classes",
      });
    }
    if (volley >= 0.2) {
      notes.push({
        id: "class-volleys",
        title: "Takes the ball early",
        detail: `${pct(volley)} of classified shots were read as volleys, ${over}. Keep it tight and deep.`,
        basis: "classes",
      });
    }
  }

  return notes.slice(0, 6);
}

// ------------------------------------------------------------------ calendar

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  minutes: number;
  titles: string[];
  /** 0 = nothing; 1..4 relative to the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
  /** False for days after today in the last column — drawn blank. */
  inRange: boolean;
}

export interface CalendarMonthLabel {
  /** Column index the label sits over. */
  col: number;
  label: string;
}

export interface Calendar {
  /** Columns, oldest first; each column is Mon..Sun. */
  weeks: CalendarDay[][];
  months: CalendarMonthLabel[];
  /** Busiest day's count — the legend's top. */
  max: number;
  /** Total recordings that fell inside the window. */
  inWindow: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDayLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The recordings calendar: one cell per day, one column per week, the most
 * recent `weeks` weeks ending on the week that contains `today`. A day's
 * level is its recording count relative to the busiest day, so one recording
 * on a quiet profile is as bright as it will ever be — a sparse grid should
 * still light up. Weeks start on Monday.
 */
export function calendarWeeks(clips: readonly PlayerClip[], today: Date, weeks = 52): Calendar {
  const byDay = new Map<string, { count: number; minutes: number; titles: string[] }>();
  for (const clip of clips) {
    const entry = byDay.get(clip.playedAt) ?? { count: 0, minutes: 0, titles: [] };
    entry.count += 1;
    entry.minutes += clip.durationSec / 60;
    if (clip.title.length > 0) entry.titles.push(clip.title);
    byDay.set(clip.playedAt, entry);
  }

  const todayKey = isoDayLocal(today);
  // Monday of this week: JS getDay() is 0=Sun..6=Sat.
  const offsetToMonday = (today.getDay() + 6) % 7;
  const thisMonday = addDays(today, -offsetToMonday);
  const firstMonday = addDays(thisMonday, -7 * (weeks - 1));

  let max = 0;
  let inWindow = 0;
  const columns: CalendarDay[][] = [];
  const months: CalendarMonthLabel[] = [];
  let previousMonth = -1;
  for (let week = 0; week < weeks; week += 1) {
    const column: CalendarDay[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(firstMonday, week * 7 + day);
      const key = isoDayLocal(date);
      const inRange = key <= todayKey;
      const entry = inRange ? byDay.get(key) : undefined;
      const count = entry?.count ?? 0;
      if (count > max) max = count;
      inWindow += count;
      column.push({
        date: key,
        count,
        minutes: entry?.minutes ?? 0,
        titles: entry?.titles ?? [],
        level: 0,
        inRange,
      });
      if (day === 0) {
        const month = date.getMonth();
        // A label at each month boundary, but not in the very first column
        // when the month began in the previous (absent) week — it would sit
        // half off the grid.
        if (month !== previousMonth && (week > 0 || date.getDate() <= 7)) {
          months.push({ col: week, label: MONTHS[month] ?? "" });
        }
        previousMonth = month;
      }
    }
    columns.push(column);
  }
  for (const column of columns) {
    for (const cell of column) {
      if (cell.count <= 0 || max <= 0) continue;
      cell.level = Math.max(1, Math.min(4, Math.round((cell.count / max) * 4))) as 1 | 2 | 3 | 4;
    }
  }
  return { weeks: columns, months, max, inWindow };
}

// ------------------------------------------------------------- court movement

/**
 * Where on the court a player's time went, recording by recording — the
 * "meta" view of movement that a single heatmap cannot give: a coach wants
 * to see whether someone has drifted deeper over a season, whether they
 * live on one side, and how much of the court they actually use.
 *
 * Everything here is read off the per-clip coverage heatmap (row 0 = the
 * front wall, columns left to right as the camera sees the court — the
 * contract in analysis/types.ts). Depth is split into thirds of the rows;
 * width into left / centre / right with the outer bands taking 3/8 of the
 * columns each (3-2-3 on the standard 8-column grid). Per-clip maps are
 * normalised to their busiest cell, so a region's SHARE of the map's total
 * is still its share of the player's time — the scale factor cancels.
 *
 * "Spread" is the share of cells holding at least a tenth of the busiest
 * cell's time: a crude but honest measure of how much of the court they
 * covered. All of this is position-based — measured, not inferred.
 */
export interface RegionShares {
  front: number;
  middle: number;
  back: number;
  left: number;
  centre: number;
  right: number;
  /** 0..1 — share of cells at or above SPREAD_THRESHOLD of the peak. */
  spread: number;
}

export const SPREAD_THRESHOLD = 0.1;

export interface MovementPoint extends RegionShares {
  clipId: string;
  playedAt: string;
  title: string;
  durationSec: number;
  tTimePct: number;
}

export interface MovementProfile {
  /** Chronological; only clips that carry a coverage map. */
  points: MovementPoint[];
  /** Time-weighted over `points`; null when there are none. */
  pooled: RegionShares | null;
  clipsWithoutCoverage: number;
}

/** Region shares of one coverage map, or null when it holds no time at all. */
export function regionShares(coverage: CoverageHeatmap): RegionShares | null {
  const { rows, cols, values } = coverage;
  if (rows < 1 || cols < 1) return null;
  let total = 0;
  for (const value of values) total += value;
  if (total <= 0) return null;

  const frontEnd = rows / 3;
  const middleEnd = (2 * rows) / 3;
  // Outer bands: 3/8 of the columns each, at least one column; whatever is
  // left is the centre (zero on a very narrow grid — then "centre" is empty
  // and the split is simply left/right).
  const side = Math.max(1, Math.floor((cols * 3) / 8));
  const leftEnd = cols < 2 ? cols : Math.min(side, Math.floor(cols / 2));
  const rightStart = cols < 2 ? cols : Math.max(leftEnd, cols - side);

  let front = 0;
  let middle = 0;
  let back = 0;
  let left = 0;
  let centre = 0;
  let right = 0;
  let lit = 0;
  for (let index = 0; index < rows * cols; index += 1) {
    const value = values[index] ?? 0;
    const row = Math.floor(index / cols);
    const col = index % cols;
    // A cell straddling a third boundary belongs to the third its centre is in.
    const rowCentre = row + 0.5;
    if (rowCentre < frontEnd) front += value;
    else if (rowCentre < middleEnd) middle += value;
    else back += value;
    if (col < leftEnd) left += value;
    else if (col >= rightStart) right += value;
    else centre += value;
    if (value >= SPREAD_THRESHOLD) lit += 1;
  }
  return {
    front: front / total,
    middle: middle / total,
    back: back / total,
    left: left / total,
    centre: centre / total,
    right: right / total,
    spread: lit / (rows * cols),
  };
}

export function movementProfile(input: readonly PlayerClip[]): MovementProfile {
  const clips = sortChronologically(input);
  const points: MovementPoint[] = [];
  let clipsWithoutCoverage = 0;
  for (const clip of clips) {
    const coverage = clip.summary.me.coverage;
    const shares = coverage === null ? null : regionShares(coverage);
    if (shares === null) {
      clipsWithoutCoverage += 1;
      continue;
    }
    points.push({
      ...shares,
      clipId: clip.id,
      playedAt: clip.playedAt,
      title: clip.title,
      durationSec: clip.summary.durationSec,
      tTimePct: clip.summary.me.tTimePct,
    });
  }
  if (points.length === 0) return { points, pooled: null, clipsWithoutCoverage };

  // Time-weighted, like T-time and the pooled court plan — a long recording
  // says more about where someone lives than a short one.
  const keys = ["front", "middle", "back", "left", "centre", "right", "spread"] as const;
  const sums: Record<(typeof keys)[number], number> = {
    front: 0, middle: 0, back: 0, left: 0, centre: 0, right: 0, spread: 0,
  };
  let weights = 0;
  for (const point of points) {
    const weight = Math.max(point.durationSec, 1);
    weights += weight;
    for (const key of keys) sums[key] += point[key] * weight;
  }
  const pooled = {} as RegionShares;
  for (const key of keys) pooled[key] = sums[key] / weights;
  return { points, pooled, clipsWithoutCoverage };
}

/** The clips played on one calendar day, oldest tag first — what a calendar cell opens. */
export function clipsOnDay(clips: readonly PlayerClip[], date: string): PlayerClip[] {
  return sortChronologically(clips).filter((clip) => clip.playedAt === date);
}
