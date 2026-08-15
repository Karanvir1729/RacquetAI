/**
 * Squash score state machine — PAR-11, pure and deterministic. The AI
 * pipeline's job ends at "side X won the rally at t=…" (RallyEndEvent) plus
 * "play stopped for an appeal at t=…" (LetDecisionEvent); this module turns
 * that ordered stream into game/match state, tracking who serves and from
 * which box. Keeping it a plain reducer means:
 *
 * - the exact same code scores a live human-tapped match, an AI event stream,
 *   and a test fixture;
 * - human corrections are just "re-fold the edited event list" — no
 *   incremental mutation to un-pick;
 * - it is trivially unit-testable long before any model exists.
 *
 * Rules implemented (World Squash Federation singles, PAR-11):
 * - point-a-rally: every rally scores for its winner;
 * - game to `pointsPerGame` (11), must win by 2, no cap;
 * - match is best of 5 (first to `gamesToWin` = 3);
 * - rally winner serves next; a retained serve alternates boxes, a handout
 *   (or game start) lets the new server choose either box;
 * - the winner of a game serves first in the next game;
 * - let → rally replayed (server and box unchanged); stroke → rally to the
 *   appealer; no-let → rally to the appealer's opponent.
 *
 * SKELETON status: scoring, serve hand, and box tracking are implemented.
 * Not yet modelled: conduct penalties (conduct stroke/game), injury
 * stoppages — see docs/03-ai-scoring-plan.md.
 */

import {
  DEFAULT_SQUASH_CONFIG,
  LetRuling,
  OTHER_SIDE,
  ScoreEngine,
  ScoreEvent,
  ServeBox,
  Side,
  SquashConfig,
  SquashScore,
} from "./types";

const FLIP_BOX: Record<ServeBox, ServeBox> = { left: "right", right: "left" };

/**
 * Fresh 0-0 state. `firstServer` is whoever won the racquet spin; the box
 * defaults to "right" until `chooseSquashServeBox` records the actual choice.
 */
export function createSquashScore(
  config: SquashConfig = DEFAULT_SQUASH_CONFIG,
  firstServer: Side = "A",
): SquashScore {
  return {
    sport: "squash",
    config,
    points: { A: 0, B: 0 },
    games: { A: 0, B: 0 },
    gameHistory: [],
    server: firstServer,
    serveBox: "right",
    serverMayChooseBox: true,
    winner: null,
  };
}

/** Fold an ordered event stream into a score. Events after match end are ignored. */
export function reduceSquashEvents(
  events: readonly ScoreEvent[],
  config: SquashConfig = DEFAULT_SQUASH_CONFIG,
  firstServer: Side = "A",
): SquashScore {
  return events.reduce<SquashScore>(
    (score, e) => applySquashEvent(score, e),
    createSquashScore(config, firstServer),
  );
}

/** Fold one pipeline event. Total: unknown-to-squash situations are no-ops. */
export function applySquashEvent(score: SquashScore, event: ScoreEvent): SquashScore {
  switch (event.kind) {
    case "rally":
      return applySquashRally(score, event.winner);
    case "let-decision":
      return applySquashLetDecision(score, event.appealer, event.ruling);
  }
}

/**
 * Apply one completed rally. Returns a new state; never mutates. Calling it on
 * a finished match is a no-op (the reducer stays total, which matters when a
 * human correction shortens the match under trailing AI events).
 */
export function applySquashRally(score: SquashScore, winner: Side): SquashScore {
  if (score.winner) return score;

  const points: Record<Side, number> = { ...score.points, [winner]: score.points[winner] + 1 };
  const loser = OTHER_SIDE[winner];
  const { pointsPerGame } = score.config;

  // Game won: reached pointsPerGame with a 2-point margin (10-10 plays on).
  if (points[winner] >= pointsPerGame && points[winner] - points[loser] >= 2) {
    return winGame(score, winner, points);
  }

  return winner === score.server
    ? {
        // Retained serve: same hand, alternate box; any open box choice is spent.
        ...score,
        points,
        serveBox: FLIP_BOX[score.serveBox],
        serverMayChooseBox: false,
      }
    : {
        // Handout: receiver becomes server and may choose either box.
        ...score,
        points,
        server: winner,
        serveBox: "right",
        serverMayChooseBox: true,
      };
}

/**
 * Record the incoming server's box choice. Only legal at game start or right
 * after a handout; at any other time this is a no-op (total, so replaying an
 * edited event list can never throw mid-fold).
 */
export function chooseSquashServeBox(score: SquashScore, box: ServeBox): SquashScore {
  if (score.winner || !score.serverMayChooseBox) return score;
  return { ...score, serveBox: box, serverMayChooseBox: false };
}

/**
 * Apply a let/stroke/no-let ruling:
 * - "let": rally replayed — score, server, and box all stay put (the event
 *   still lives in Match.events, which is exactly what video review needs);
 * - "stroke": rally awarded to the appealer;
 * - "no-let": rally awarded to the appealer's opponent.
 */
export function applySquashLetDecision(
  score: SquashScore,
  appealer: Side,
  ruling: LetRuling,
): SquashScore {
  if (score.winner) return score;
  switch (ruling) {
    case "let":
      return score;
    case "stroke":
      return applySquashRally(score, appealer);
    case "no-let":
      return applySquashRally(score, OTHER_SIDE[appealer]);
  }
}

function winGame(score: SquashScore, winner: Side, finalPoints: Record<Side, number>): SquashScore {
  const games: Record<Side, number> = { ...score.games, [winner]: score.games[winner] + 1 };
  const finished = games[winner] >= score.config.gamesToWin;
  return {
    ...score,
    games,
    gameHistory: [...score.gameHistory, finalPoints],
    points: { A: 0, B: 0 },
    // Winner of a game serves first in the next, choosing their box.
    server: winner,
    serveBox: "right",
    serverMayChooseBox: true,
    winner: finished ? winner : null,
  };
}

/** One-line scoreboard: "7-5 · games 1-0 · A serves (right)" / "A wins 3-1". */
export function formatSquashScore(score: SquashScore): string {
  if (score.winner) {
    const w = score.winner;
    return `${w} wins ${score.games[w]}-${score.games[OTHER_SIDE[w]]}`;
  }
  return (
    `${score.points.A}-${score.points.B}` +
    ` · games ${score.games.A}-${score.games.B}` +
    ` · ${score.server} serves (${score.serveBox})`
  );
}

/** The squash engine behind the shared per-sport interface. */
export const squashEngine: ScoreEngine<SquashScore> = {
  sport: "squash",
  initial: () => createSquashScore(),
  apply: applySquashEvent,
  reduce: (events) => reduceSquashEvents(events),
  summary: formatSquashScore,
};
