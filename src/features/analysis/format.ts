/**
 * Analysis display formatting — pure and deterministic (no `toLocale*`, same
 * reasoning as features/recording/display.ts: Hermes and Node output must
 * match). Every percentage, count, and pattern label on the analysis screen
 * renders through here so the unit tests pin the exact strings.
 */
import type { ShotTypeCount } from "./shots";
import { COURT_CELLS, type CourtCell, type ShotType } from "./types";

const CELL_LABELS: Record<CourtCell, string> = {
  frontLeft: "Front left",
  frontRight: "Front right",
  backLeft: "Back left",
  backRight: "Back right",
};

/** Display name plus the two count forms — "1 drop" / "5 drops". */
const SHOT_TYPE_LABELS: Record<ShotType, { name: string; one: string; many: string }> = {
  serve: { name: "Serve", one: "serve", many: "serves" },
  drive: { name: "Drive", one: "drive", many: "drives" },
  crossCourt: { name: "Cross-court", one: "cross-court", many: "cross-courts" },
  drop: { name: "Drop", one: "drop", many: "drops" },
  boast: { name: "Boast", one: "boast", many: "boasts" },
  volley: { name: "Volley", one: "volley", many: "volleys" },
  // The classifier says "unknown" when the evidence is genuinely ambiguous;
  // the UI says so plainly rather than dressing it up as a shot class.
  unknown: { name: "Unclassified", one: "unclassified", many: "unclassified" },
};

const CELL_NAME_PATTERN = new RegExp(`\\b(${COURT_CELLS.join("|")})\\b`, "g");

/** "frontLeft" → "Front left". */
export function cellLabel(cell: CourtCell): string {
  return CELL_LABELS[cell];
}

/** "crossCourt" → "Cross-court"; the em dash stands in for an unlabelled shot. */
export function shotTypeLabel(type: ShotType | undefined): string {
  return type === undefined ? "—" : SHOT_TYPE_LABELS[type].name;
}

/**
 * A player's classified shots as one line: "12 drives · 5 drops · 3 boasts".
 * Empty when nothing is classified, so the caller can drop the whole row.
 */
export function formatShotTypeBreakdown(counts: readonly ShotTypeCount[]): string {
  return counts
    .map(({ type, count }) => {
      const labels = SHOT_TYPE_LABELS[type];
      return `${formatCount(count)} ${count === 1 ? labels.one : labels.many}`;
    })
    .join(" · ");
}

/** Fraction 0..1 → whole-percent label: 0.62 → "62%". Clamps garbage into 0–100%. */
export function formatPercent(fraction: number): string {
  const safe = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return `${Math.round(safe * 100)}%`;
}

/** Non-negative integer with thousands separators: 5520 → "5,520". */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Pipeline pattern strings name cells in code ("backLeft -> frontRight (41%)");
 * prettify each known cell name in place: "Back left -> Front right (41%)".
 * Unknown text passes through untouched.
 */
export function prettyPattern(pattern: string): string {
  return pattern.replace(CELL_NAME_PATTERN, (cell) => CELL_LABELS[cell as CourtCell]);
}

/**
 * Heatmap cell opacity for a normalized 0..1 coverage value. The floor keeps
 * empty cells faintly visible so the grid still reads as a court outline.
 */
export function heatOpacity(value: number): number {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  // sqrt lifts the mid-range: most cells sit at 5-30% of the max cell, and a
  // linear ramp left the whole map nearly invisible on the light theme.
  if (safe === 0) return 0.05;
  return 0.15 + 0.85 * Math.sqrt(safe);
}
