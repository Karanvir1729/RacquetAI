/**
 * Shot-list selection: what to summarise per player, and which shot the
 * playhead is on. Ported from the app's `src/features/analysis/shots.ts`.
 *
 * Pure, and it never assumes `shots` is sorted — the contract never promised
 * it, and a mis-ordered file must degrade to "no highlight", not to the wrong
 * highlight.
 */
import { SHOT_TYPES, type PlayerId, type ShotEvent, type ShotType } from "./types";

export interface ShotTypeCount {
  type: ShotType;
  count: number;
}

/**
 * How long a shot stays highlighted after its contact time. Roughly one
 * exchange at club pace, so the label is still on screen while the ball is in
 * the air but has cleared before the reply.
 */
export const SHOT_HIGHLIGHT_SEC = 1.5;

/** Rank for the breakdown: frequency first, "unknown" always last. */
function compareCounts(a: ShotTypeCount, b: ShotTypeCount): number {
  const aUnknown = a.type === "unknown";
  const bUnknown = b.type === "unknown";
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (a.count !== b.count) return b.count - a.count;
  // Contract order breaks ties so the line is stable between renders.
  return SHOT_TYPES.indexOf(a.type) - SHOT_TYPES.indexOf(b.type);
}

/**
 * One player's classified shots, most frequent first. Shots with no `type` (a
 * v1 analysis, or a writer that declined to guess) contribute nothing, so an
 * empty result means "this analysis has no shot types" and the UI omits the
 * whole block rather than drawing an empty chart.
 */
export function countShotTypes(shots: readonly ShotEvent[], player: PlayerId): ShotTypeCount[] {
  const counts = new Map<ShotType, number>();
  for (const shot of shots) {
    if (shot.player !== player || shot.type === undefined) continue;
    counts.set(shot.type, (counts.get(shot.type) ?? 0) + 1);
  }
  return [...counts].map(([type, count]): ShotTypeCount => ({ type, count })).sort(compareCounts);
}

/**
 * Index of the shot being played at `tSec` — the latest contact within
 * `windowSec` behind the playhead — or null between shots.
 */
export function activeShotIndex(
  shots: readonly ShotEvent[],
  tSec: number,
  windowSec: number = SHOT_HIGHLIGHT_SEC,
): number | null {
  if (!Number.isFinite(tSec)) return null;
  let best: number | null = null;
  let bestAt = -Infinity;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    if (shot === undefined) continue;
    const at = shot.tSec;
    if (at > tSec || tSec - at > windowSec) continue;
    if (best === null || at > bestAt) {
      best = index;
      bestAt = at;
    }
  }
  return best;
}

/** Shots for one player, ascending by contact time — the timeline's input. */
export function playerShots(shots: readonly ShotEvent[], player: PlayerId): ShotEvent[] {
  return shots.filter((shot) => shot.player === player).sort((a, b) => a.tSec - b.tSec);
}
