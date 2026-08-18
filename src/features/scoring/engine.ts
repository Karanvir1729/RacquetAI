/**
 * The one door onto a sport's rules. It used to be a registry over four
 * sports; the app was narrowed to squash (54fcba7) so the table has one row.
 * It survives the narrowing because it is what pins the `ScoreEngine` laws in
 * place — engine.test.ts asserts them through this function, and any second
 * racquet sport lands as a new row here rather than as an edit to callers.
 *
 * Screens that need squash-specific state (serve box, game history) call the
 * functions in squash.ts directly; this is for code that only needs "fold
 * these events and give me a scoreboard line".
 */

import { squashEngine } from "./squash";
import { ScoreEngine, SquashScore } from "./types";

/** Sports with a working score engine today. */
export type ScoredSport = "squash";

const ENGINES: Record<ScoredSport, ScoreEngine<SquashScore>> = {
  squash: squashEngine,
};

/** Total by construction — `ScoredSport` only names sports that are registered. */
export function getScoreEngine(sport: ScoredSport = "squash"): ScoreEngine<SquashScore> {
  return ENGINES[sport];
}
