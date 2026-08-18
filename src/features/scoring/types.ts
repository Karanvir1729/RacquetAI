/**
 * Squash scoring domain model — the data the Score keeper screen folds into a
 * scoreboard. Plain data + types: nothing here touches React Native, the
 * filesystem, or any model runtime, so the same code runs in the app and in
 * tests.
 *
 * Events are HUMAN calls — somebody watching the court tapped a button. There
 * is no detector behind them and no confidence to weigh; a `ScoreEvent` is a
 * record of a decision, and the ordered list of them is the only source of
 * truth. That is what makes undo cheap: drop the last event and re-fold.
 *
 * Narrowed from the multi-sport model that used to live here (54fcba7): the
 * app ships squash only, so the sport union, the tennis machine, and the
 * AI-confidence fields are gone rather than kept warm.
 */

/** The two opposing sides. Doubles is still two sides; players hang off the side. */
export type Side = "A" | "B";

export const SIDES: readonly Side[] = ["A", "B"];

export const OTHER_SIDE: Record<Side, Side> = { A: "B", B: "A" };

interface ScoreEventBase {
  /** Stable key for list rendering and for the persisted match file. */
  id: string;
  /** Epoch ms the call was made — wall clock, because this scores a live match. */
  at: number;
}

/**
 * One completed rally, attributed to a side. The main unit of input: the
 * game/match score derives from an ordered list of these.
 */
export interface RallyEndEvent extends ScoreEventBase {
  kind: "rally";
  /** Which side won the rally. */
  winner: Side;
}

/**
 * Outcome of an interference appeal ("Let, please"):
 * - "let"     → rally replayed, nobody scores;
 * - "stroke"  → rally awarded to the appealing side;
 * - "no-let"  → appeal denied, rally awarded to the other side.
 */
export type LetRuling = "let" | "stroke" | "no-let";

/** A let/stroke/no-let ruling, made by whoever is holding the phone. */
export interface LetDecisionEvent extends ScoreEventBase {
  kind: "let-decision";
  /** The side that appealed for the let. */
  appealer: Side;
  ruling: LetRuling;
}

/** The service box the next serve is struck from. */
export type ServeBox = "left" | "right";

/**
 * The incoming server's box choice, at game start or after a handout.
 *
 * It is an EVENT rather than a direct edit for one reason: state is derived by
 * folding the list, so anything that changes state has to be in the list or
 * undo would silently revert it.
 */
export interface ServeBoxEvent extends ScoreEventBase {
  kind: "serve-box";
  box: ServeBox;
}

export type ScoreEvent = RallyEndEvent | LetDecisionEvent | ServeBoxEvent;

// ---------------------------------------------------------------------------
// PAR-11: point-a-rally, first to 11, win by 2, best of 5
// ---------------------------------------------------------------------------

export interface SquashConfig {
  /** Points to win a game (11 in PAR-11); always win by 2, no cap. */
  pointsPerGame: number;
  /** Games to win the match (3 = best of 5). */
  gamesToWin: number;
}

export const DEFAULT_SQUASH_CONFIG: SquashConfig = {
  pointsPerGame: 11,
  gamesToWin: 3,
};

export interface SquashScore {
  sport: "squash";
  config: SquashConfig;
  /** Current-game points (every rally scores — point-a-rally). */
  points: Record<Side, number>;
  /** Games won so far. */
  games: Record<Side, number>;
  /** Completed games as final point counts, oldest first (e.g. [{A:11,B:7}]). */
  gameHistory: Record<Side, number>[];
  /**
   * The serving side ("hand-in") for the next rally; the receiver is
   * `OTHER_SIDE[server]`. Rally winner always serves next: a retained serve
   * alternates boxes, losing the rally hands the serve out.
   */
  server: Side;
  serveBox: ServeBox;
  /**
   * True at game start and right after a handout: the (new) server may pick
   * either box (`chooseSquashServeBox`). While retaining serve the box
   * alternates automatically and no choice is open.
   */
  serverMayChooseBox: boolean;
  /** Set once a side has won `config.gamesToWin` games. */
  winner: Side | null;
}

/** One sport today. The alias survives so `ScoreEngine` reads the same either way. */
export type MatchScore = SquashScore;

/**
 * A pure score state machine. Laws (enforced by engine.test.ts):
 * - `apply` never mutates its input and is total: events after the match is
 *   decided are no-ops, so a correction that shortens the match leaves any
 *   trailing events harmless;
 * - `reduce(events)` === events folded over `apply` from `initial()` —
 *   corrections are just "edit the list and re-fold".
 */
export interface ScoreEngine<S extends MatchScore = MatchScore> {
  readonly sport: "squash";
  /** Fresh pre-first-rally state. */
  initial(): S;
  /** Fold one event into the state. */
  apply(state: S, event: ScoreEvent): S;
  /** Fold an ordered event stream from scratch. */
  reduce(events: readonly ScoreEvent[]): S;
  /** One-line scoreboard string for the current state. */
  summary(state: S): string;
}
