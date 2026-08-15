/**
 * Tennis score state machine — pure and deterministic. The AI pipeline's job
 * ends at "side X won a point at t=…" (ScoreEvent); this module turns that
 * ordered stream into game/set/match state. Keeping it a plain reducer means:
 *
 * - the exact same code scores a live human-tapped match, an AI event stream,
 *   and a test fixture;
 * - human corrections are just "re-fold the edited event list" — no incremental
 *   mutation to un-pick;
 * - it is trivially unit-testable long before any model exists.
 *
 * SKELETON status: standard scoring (love/15/30/40/deuce/advantage), games,
 * sets with a tiebreak at gamesPerSet-all, and best-of-N match completion are
 * implemented. Not yet modelled: serve tracking, match tiebreaks in lieu of a
 * final set, and no-ad scoring — see docs/03-ai-scoring-plan.md.
 */

import {
  DEFAULT_TENNIS_CONFIG,
  OTHER_SIDE,
  ScoreEvent,
  Side,
  TennisConfig,
  TennisPoint,
  TennisScore,
} from "./types";

/** Fresh 0-0 state. */
export function createTennisScore(config: TennisConfig = DEFAULT_TENNIS_CONFIG): TennisScore {
  return {
    sport: "tennis",
    config,
    points: { A: "0", B: "0" },
    games: { A: 0, B: 0 },
    sets: { A: 0, B: 0 },
    setHistory: [],
    tiebreakPoints: null,
    winner: null,
  };
}

/** Fold an ordered event stream into a score. Events after match point are ignored. */
export function reduceTennisEvents(
  events: readonly Pick<ScoreEvent, "winner">[],
  config: TennisConfig = DEFAULT_TENNIS_CONFIG,
): TennisScore {
  return events.reduce<TennisScore>(
    (score, e) => applyTennisPoint(score, e.winner),
    createTennisScore(config),
  );
}

/**
 * Apply one won point. Returns a new state; never mutates. Calling it on a
 * finished match is a no-op (the reducer stays total, which matters when a
 * human correction shortens the match under trailing AI events).
 */
export function applyTennisPoint(score: TennisScore, winner: Side): TennisScore {
  if (score.winner) return score;
  if (score.tiebreakPoints) return applyTiebreakPoint(score, score.tiebreakPoints, winner);
  return applyGamePoint(score, winner);
}

/** Standard-game point progression: 0 → 15 → 30 → 40 → (deuce/AD) → game. */
function applyGamePoint(score: TennisScore, winner: Side): TennisScore {
  const loser = OTHER_SIDE[winner];
  const w = score.points[winner];
  const l = score.points[loser];

  // Game won: winner on 40 with the loser short of 40, or winner on AD.
  if (w === "AD" || (w === "40" && l !== "40" && l !== "AD")) {
    return winGame(score, winner);
  }
  // Deuce ↔ advantage territory.
  if (w === "40" && l === "AD") {
    // Back to deuce.
    return withPoints(score, { A: "40", B: "40" });
  }
  if (w === "40" && l === "40") {
    return withPoints(score, { ...score.points, [winner]: "AD" });
  }
  const ladder: Record<Exclude<TennisPoint, "AD">, TennisPoint> = {
    "0": "15",
    "15": "30",
    "30": "40",
    "40": "40", // unreachable: 40-x cases handled above; keeps the map total
  };
  return withPoints(score, { ...score.points, [winner]: ladder[w as Exclude<TennisPoint, "AD">] });
}

/** Tiebreak: first to `tiebreakTo`, win by 2; winner takes the set 7-6 style. */
function applyTiebreakPoint(
  score: TennisScore,
  tb: Record<Side, number>,
  winner: Side,
): TennisScore {
  const next: Record<Side, number> = { ...tb, [winner]: tb[winner] + 1 };
  const loser = OTHER_SIDE[winner];
  if (next[winner] >= score.config.tiebreakTo && next[winner] - next[loser] >= 2) {
    const games = { ...score.games, [winner]: score.games[winner] + 1 };
    return winSet({ ...score, games, tiebreakPoints: null }, winner);
  }
  return { ...score, tiebreakPoints: next };
}

function winGame(score: TennisScore, winner: Side): TennisScore {
  const loser = OTHER_SIDE[winner];
  const games: Record<Side, number> = { ...score.games, [winner]: score.games[winner] + 1 };
  const { gamesPerSet } = score.config;

  // Set won outright: reached gamesPerSet with a 2-game margin, or the 7-5 style
  // one-past win after the opponent had been at gamesPerSet - 1.
  if (games[winner] >= gamesPerSet && games[winner] - games[loser] >= 2) {
    return winSet({ ...score, games, points: { A: "0", B: "0" } }, winner);
  }
  // gamesPerSet-all → tiebreak.
  if (games[winner] === gamesPerSet && games[loser] === gamesPerSet) {
    return {
      ...score,
      games,
      points: { A: "0", B: "0" },
      tiebreakPoints: { A: 0, B: 0 },
    };
  }
  return { ...score, games, points: { A: "0", B: "0" } };
}

function winSet(score: TennisScore, winner: Side): TennisScore {
  const sets: Record<Side, number> = { ...score.sets, [winner]: score.sets[winner] + 1 };
  const finished = sets[winner] >= score.config.setsToWin;
  return {
    ...score,
    sets,
    setHistory: [...score.setHistory, score.games],
    games: { A: 0, B: 0 },
    points: { A: "0", B: "0" },
    tiebreakPoints: null,
    winner: finished ? winner : null,
  };
}

function withPoints(score: TennisScore, points: Record<Side, TennisPoint>): TennisScore {
  return { ...score, points };
}

/**
 * Scoreboard string for the current game, called from the winner's-side-first
 * convention used by chair umpires ("40-15", "Deuce", "Ad A").
 */
export function formatTennisGame(score: TennisScore): string {
  if (score.tiebreakPoints) return `TB ${score.tiebreakPoints.A}-${score.tiebreakPoints.B}`;
  const { A, B } = score.points;
  if (A === "40" && B === "40") return "Deuce";
  if (A === "AD") return "Ad A";
  if (B === "AD") return "Ad B";
  return `${A}-${B}`;
}
