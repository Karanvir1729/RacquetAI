/**
 * Numbers shown in the hero, and nowhere else.
 *
 * These are NOT invented. Every value is copied from the real pipeline output
 * in `analysis/out/archive_match2_v2/analysis.json` (schemaVersion 2) — the
 * same file the /demo route renders in full. Keeping the hero honest means the
 * marketing page and the product can never disagree.
 *
 * Source footage: archive.org, CC BY-NC 4.0, 854x480, 29.97 fps, 451.45 s.
 */

export const HERO_MATCH = {
  durationLabel: "7:31",
  shots: 320,
  rallies: 9,
  longestRally: 59,
  framesAnalyzed: 3383,
  bothPlayersDetectedPct: 78.7,
  resolution: "854×480",
  license: "CC BY-NC 4.0",
} as const;

export const HERO_PLAYER = {
  label: "Player A",
  shots: 156,
  /** Percent of sampled frames within 1.5 m of the T. */
  tTimePct: 23.5,
  /** 0..1 — higher means more repetitive shot selection. */
  predictability: 0.252,
  topPattern: "Back right → back right (24%)",
  placement: { frontLeft: 11, frontRight: 15, backLeft: 66, backRight: 64 },
} as const;

/**
 * Player A's coverage heatmap, exactly as the pipeline emitted it: 12 rows x 8
 * columns, row-major, row 0 nearest the front wall, each value normalized 0..1.
 */
export const HERO_HEATMAP = {
  rows: 12,
  cols: 8,
  values: [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.01, 0.0, 0.0, 0.01, 0.01, 0.02, 0.01, 0.01, 0.02, 0.0,
    0.03, 0.02, 0.0, 0.0, 0.01, 0.02, 0.03, 0.0, 0.07, 0.03, 0.0, 0.0, 0.01, 0.01, 0.04, 0.0, 0.1,
    0.06, 0.02, 0.0, 0.01, 0.02, 0.04, 0.0, 0.05, 0.14, 0.1, 0.04, 0.04, 0.07, 0.12, 0.0, 0.09,
    0.13, 0.12, 0.11, 0.12, 0.08, 0.21, 0.02, 0.06, 0.15, 0.21, 0.49, 0.17, 0.1, 0.12, 0.04, 0.19,
    0.42, 0.55, 0.68, 0.23, 0.21, 0.19, 0.07, 0.18, 1.0, 0.39, 0.29, 0.24, 0.18, 0.17, 0.01, 0.12,
    0.29, 0.15, 0.13, 0.18, 0.1, 0.21, 0.0, 0.0, 0.01, 0.02, 0.02, 0.02, 0.02, 0.09,
  ],
} as const;
