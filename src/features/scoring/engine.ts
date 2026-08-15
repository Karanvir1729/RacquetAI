/**
 * The engine registry — the ONLY door callers use to reach a sport's rules.
 * Scoreboard UI, review UX, and the server-side results assembler all do
 * `getScoreEngine(match.sport)` and speak `ScoreEngine`; adding pickleball or
 * badminton later means registering a new engine here, not touching callers.
 */

import { squashEngine } from "./squash";
import { tennisEngine } from "./tennis";
import { MatchScore, ScoreEngine, Sport } from "./types";

const ENGINES: Partial<Record<Sport, ScoreEngine<MatchScore>>> = {
  squash: squashEngine,
  tennis: tennisEngine,
  // pickleball / badminton: score shapes exist in types.ts; engines land when
  // the sports do. Callers must gate on hasScoreEngine() for those sports.
};

export function hasScoreEngine(sport: Sport): boolean {
  return ENGINES[sport] !== undefined;
}

/** Throws for sports whose engine hasn't landed — gate with hasScoreEngine(). */
export function getScoreEngine(sport: Sport): ScoreEngine<MatchScore> {
  const engine = ENGINES[sport];
  if (!engine) {
    throw new Error(`No score engine registered for "${sport}" yet — see src/features/scoring.`);
  }
  return engine;
}
