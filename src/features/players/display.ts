/**
 * Profile display helpers — pure and deterministic (no `toLocale*`, the
 * features/analysis/format.ts rule: Hermes and Node output must match, so the
 * unit tests pin the exact strings). Dates, the racquet-hand words, and the
 * shot-mix ordering every profile surface shares.
 *
 * Cross-feature imports, documented (docs/01 rule 2): the shot-class labels
 * and the `ShotTypeCount` shape are the analysis feature's, and the profile
 * must word a shot class exactly as the read-out does — a "Cross-court" here
 * and a "Crosscourt" there would read as two different things.
 */
import type { ShotTypeCount } from "../analysis/shots";
import { SHOT_TYPES } from "../analysis/types";
import type { NoteBasis } from "./aggregate";
import type { Hand, ShotTypeCounts } from "./shape";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-08-21" → "21 Aug 2026". The same rendering the web's calendar and
 * recordings list use, so a date reads identically wherever a profile
 * appears. Anything that is not YYYY-MM-DD passes through untouched.
 */
export function formatIsoDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return iso;
  const year = match[1] ?? "";
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (month === undefined || !Number.isFinite(day)) return iso;
  return `${day} ${month} ${year}`;
}

export const HAND_LABELS: Record<Hand, string> = { right: "Right-handed", left: "Left-handed" };

/** "1 recording" / "4 recordings" — the word the whole feature uses for a tagged clip. */
export function recordingsWord(count: number): string {
  return `${count} ${count === 1 ? "recording" : "recordings"}`;
}

/** What a scouting note rests on, as the chip under it says. */
export function basisLabel(basis: NoteBasis): string {
  return basis === "position" ? "From position & timing" : "From shot classes · indicative";
}

/**
 * The pooled shot classes in the shape the read-out's breakdown takes — most
 * frequent first, "unknown" last, contract order breaking ties — the same
 * ranking `countShotTypes` in analysis/shots.ts applies to a single match, so
 * the profile's mix and a read-out's mix line up class for class.
 */
export function shotTypeCounts(counts: ShotTypeCounts): ShotTypeCount[] {
  return SHOT_TYPES.filter((type) => counts[type] > 0)
    .map((type): ShotTypeCount => ({ type, count: counts[type] }))
    .sort((a, b) => {
      const aUnknown = a.type === "unknown";
      const bUnknown = b.type === "unknown";
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      if (a.count !== b.count) return b.count - a.count;
      return SHOT_TYPES.indexOf(a.type) - SHOT_TYPES.indexOf(b.type);
    });
}
