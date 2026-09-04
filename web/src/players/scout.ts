/**
 * The opponent brief — a player profile reduced to what the coach is told
 * before a "how do I play against X?" conversation. Pure, relative imports
 * (jest runs it), no I/O.
 *
 * Why a brief and not the profile: the coach runs on the analysis server
 * (analysis/coach_api.py) and the server re-validates everything it is sent,
 * field by field, before a word of it reaches a model prompt. A small, flat,
 * fully-typed object with every number already rounded and every string
 * already capped is what makes that re-validation a short list of rules on
 * both sides rather than a second copy of the profile maths. The numbers in
 * it are the profile page's own (aggregate.ts), so what the coach is told is
 * what the page shows — never more.
 *
 * What it claims, and on what, is the product's rule with the usual force:
 * "placement" is where the OPPONENT retrieved the ball — a proxy for where a
 * shot went, because there is no ball tracking; shot detection was audited at
 * ~63% precision; shot classes are unaudited and travel marked indicative;
 * every scouting note carries its basis. The server writes the model's
 * version of those caveats itself — `briefToText` here is only for showing
 * the PERSON what the coach was handed.
 */
import { SHOT_TYPES, type CourtCell, type ShotType } from "../analysis/types";
import type { NoteBasis, ProfileStats, ScoutingNote } from "./aggregate";
import type { Hand, Player } from "./shape";

export const BRIEF_NAME_MAX = 80;
export const BRIEF_TITLE_MAX = 120;
export const BRIEF_DETAIL_MAX = 400;
export const BRIEF_MAX_PATTERNS = 3;
export const BRIEF_MAX_SHOT_TYPES = 6;
export const BRIEF_MAX_NOTES = 6;

export interface BriefPattern {
  /** Contract grammar, "backLeft -> frontRight" — the server checks it against the same grammar. */
  pattern: string;
  /** Of all this player's shot-to-next-shot transitions, 0..1. */
  share: number;
}

export interface BriefShotType {
  type: string;
  /** Of the CLASSIFIED shots, 0..1 — unclassified shots are not in the base. */
  share: number;
}

export interface BriefNote {
  title: string;
  detail: string;
  basis: NoteBasis;
}

export interface OpponentBrief {
  name: string;
  hand: Hand | null;
  recordings: number;
  /** Footage tagged to them, in minutes (1 dp). */
  minutes: number;
  /** Shots detected as theirs across every recording. */
  shots: number;
  /** Percent (0..100, 1 dp) of frames within 1.5 m of the T; null with no footage. */
  tTimePct: number | null;
  /** Their T-time minus the people they played, in points; null with no two-player clips. */
  tTimeVsOpponents: number | null;
  /** 0..1 over the pooled transition matrix; null until there are transitions. */
  predictability: number | null;
  topPatterns: BriefPattern[];
  /** Share of their shots retrieved in the front court; null with no placement. */
  frontShare: number | null;
  leftShare: number | null;
  /** Indicative — classes are unaudited. Only types seen, most frequent first. */
  shotMix: BriefShotType[];
  classifiedShots: number;
  notes: BriefNote[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function roundedOrNull(value: number | null, round: (value: number) => number): number | null {
  return value === null || !Number.isFinite(value) ? null : round(value);
}

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * The pooled shot classes, most frequent first, "unknown" last, contract
 * order breaking ties — the same ranking the profile page's bars use, so the
 * coach's list and the page's bars line up.
 */
function shotMixOf(stats: ProfileStats): BriefShotType[] {
  const total = stats.classifiedShots;
  if (total <= 0) return [];
  return SHOT_TYPES.filter((type) => stats.shotTypes[type] > 0)
    .map((type) => ({ type, count: stats.shotTypes[type] }))
    .sort((a, b) => {
      const aUnknown = a.type === "unknown";
      const bUnknown = b.type === "unknown";
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      return b.count - a.count || SHOT_TYPES.indexOf(a.type) - SHOT_TYPES.indexOf(b.type);
    })
    .slice(0, BRIEF_MAX_SHOT_TYPES)
    .map(({ type, count }) => ({ type, share: round3(count / total) }));
}

/**
 * One profile → the brief. Takes the stats and notes the profile page already
 * computed rather than the clips, so the coach is told exactly what the page
 * shows (same thresholds, same silence under the minimum sample).
 */
export function opponentBrief(
  player: Player,
  stats: ProfileStats,
  notes: readonly ScoutingNote[],
): OpponentBrief {
  return {
    name: cap(player.name.trim(), BRIEF_NAME_MAX),
    hand: player.hand,
    recordings: Math.max(0, Math.round(stats.recordings)),
    minutes: round1(Math.max(0, stats.totalSec) / 60),
    shots: Math.max(0, Math.round(stats.totalShots)),
    tTimePct: roundedOrNull(stats.tTimePct, round1),
    tTimeVsOpponents:
      stats.versus.clips > 0 ? roundedOrNull(stats.versus.tTimeDelta, round1) : null,
    predictability: roundedOrNull(stats.predictability, round3),
    topPatterns: stats.topPatterns
      .slice(0, BRIEF_MAX_PATTERNS)
      .map((top) => ({ pattern: top.pattern, share: round3(top.share) })),
    frontShare: roundedOrNull(stats.frontShare, round3),
    leftShare: roundedOrNull(stats.leftShare, round3),
    shotMix: shotMixOf(stats),
    classifiedShots: Math.max(0, Math.round(stats.classifiedShots)),
    notes: notes.slice(0, BRIEF_MAX_NOTES).map((note) => ({
      title: cap(note.title, BRIEF_TITLE_MAX),
      detail: cap(note.detail, BRIEF_DETAIL_MAX),
      basis: note.basis,
    })),
  };
}

// ---------------------------------------------------------------- for people

const CELL_WORDS: Record<CourtCell, string> = {
  frontLeft: "front left",
  frontRight: "front right",
  backLeft: "back left",
  backRight: "back right",
};

const SHOT_WORDS: Partial<Record<ShotType, string>> = {
  crossCourt: "cross-court",
  unknown: "unclassified",
};

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function cellWord(cell: string): string {
  return (CELL_WORDS as Record<string, string>)[cell] ?? cell;
}

function patternSentence(top: BriefPattern): string {
  const [from, to] = top.pattern.split(" -> ");
  return `after a shot to the ${cellWord(from ?? "")}, the next went ${cellWord(to ?? "")} ${pct(
    top.share,
  )} of the time`;
}

/**
 * The brief in plain English — what the "What the coach was told" disclosure
 * shows. For the person, NOT for the model: the server writes its own prompt
 * block from the same fields, with its own wording of the caveats, so the two
 * can never drift into the client claiming more than the server does.
 */
export function briefToText(b: OpponentBrief): string {
  const lines: string[] = [];
  const who = b.hand === null ? b.name : `${b.name} (${b.hand}-handed)`;
  if (b.recordings <= 0) {
    lines.push(`${who}: no footage tagged yet, so the coach has the name and nothing else.`);
    return lines.join("\n");
  }
  lines.push(
    `${who}: ${b.recordings} ${b.recordings === 1 ? "recording" : "recordings"}, ${b.minutes} minutes of footage you tagged, ${b.shots} shots detected as theirs.`,
  );

  if (b.tTimePct !== null) {
    let t = `Within 1.5 m of the T ${b.tTimePct}% of the time`;
    if (b.tTimeVsOpponents !== null) {
      const delta = Math.abs(b.tTimeVsOpponents);
      t +=
        delta < 1
          ? " — about the same as the people they played"
          : ` — ${delta} points ${b.tTimeVsOpponents > 0 ? "more" : "less"} than the people they played`;
    }
    lines.push(`${t}. (Measured from position.)`);
  }

  if (b.predictability !== null) {
    let p = `Predictability ${pct(b.predictability)} (higher means easier to read)`;
    if (b.topPatterns.length > 0) {
      p += `: ${b.topPatterns.map(patternSentence).join("; ")}`;
    }
    lines.push(`${p}. (Measured from where shots were retrieved.)`);
  }

  if (b.frontShare !== null || b.leftShare !== null) {
    const parts: string[] = [];
    if (b.frontShare !== null) parts.push(`${pct(b.frontShare)} of their shots went short`);
    if (b.leftShare !== null) parts.push(`${pct(b.leftShare)} went to the left`);
    lines.push(
      `${parts.join(", ")}. (Placement is where the ball was retrieved — a proxy for where it went; there is no ball tracking.)`,
    );
  }

  if (b.shotMix.length > 0) {
    const mix = b.shotMix
      .map((item) => `${(SHOT_WORDS as Record<string, string>)[item.type] ?? item.type} ${pct(item.share)}`)
      .join(", ");
    lines.push(
      `Shot mix over ${b.classifiedShots} classified shots (indicative — classes are unaudited): ${mix}.`,
    );
  }

  if (b.notes.length > 0) {
    lines.push("Scouting notes:");
    for (const note of b.notes) {
      const basis =
        note.basis === "position" ? "from position & timing" : "from shot classes, indicative";
      lines.push(`- ${note.title} (${basis}): ${note.detail}`);
    }
  }

  lines.push(
    "The coach is told these are pooled measurements from footage you tagged, not a human's scouting report, and that it cannot know results or who won.",
  );
  return lines.join("\n");
}
