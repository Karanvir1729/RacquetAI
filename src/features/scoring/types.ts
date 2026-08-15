/**
 * Scoring domain model — the contract between the future AI pipeline and the
 * app. The pipeline (docs/03-ai-scoring-plan.md) emits `ScoreEvent`s; the pure
 * per-sport state machines (squash.ts and tennis.ts today, pickleball and
 * badminton later) fold them into a `MatchScore`. Nothing in this file touches
 * React Native, the network, or any model runtime — it is plain data + types
 * so the same code runs in the app, in tests, and in the server-side results
 * assembler.
 *
 * Squash is the primary sport (fixed-camera club courts, box leagues,
 * let/stroke video review), so it is modelled first and most completely.
 */

export type Sport = "squash" | "tennis" | "pickleball" | "badminton";

/** The two opposing sides. Doubles is still two sides; players hang off the side. */
export type Side = "A" | "B";

export const OTHER_SIDE: Record<Side, Side> = { A: "B", B: "A" };

/** Where a score event came from — the correction UX depends on this. */
export type ScoreEventSource = "ai" | "human";

interface ScoreEventBase {
  id: string;
  /** Seconds into the source video where the event happened (rally end / stoppage). */
  tSec: number;
  /** Model confidence, 0..1. Human events carry 1. */
  confidence: number;
  source: ScoreEventSource;
  /**
   * If a human corrected an AI event, the id of the AI event it replaces —
   * kept so corrections are an audit trail, not a destructive edit.
   */
  corrects?: string;
}

/**
 * One completed rally, attributed to a side. This is the pipeline's main unit
 * of output: everything downstream (game/set/match score, timeline scrubbing,
 * highlights) derives from an ordered list of these.
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

/**
 * A let/stroke decision — first-class because reviewing interference calls on
 * video is the single most valuable refereeing use case in squash. The AI only
 * DETECTS the stoppage and bookmarks it; the ruling itself always comes from a
 * human (player, marker, or referee) via the review UX.
 */
export interface LetDecisionEvent extends ScoreEventBase {
  kind: "let-decision";
  /** The side that appealed for the let. */
  appealer: Side;
  ruling: LetRuling;
}

export type ScoreEvent = RallyEndEvent | LetDecisionEvent;

/** Below this confidence the app queues an AI event for human review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

export function needsReview(event: ScoreEvent): boolean {
  return event.source === "ai" && event.confidence < REVIEW_CONFIDENCE_THRESHOLD;
}

export type MatchStatus =
  | "recorded" // video exists, no analysis attempted
  | "queued" // uploaded, waiting for pipeline
  | "analyzing"
  | "review" // AI done; low-confidence points await human confirmation
  | "scored" // timeline confirmed
  | "failed";

/** A recorded match: the video plus everything scoring needs to know about it. */
export interface Match {
  id: string;
  sport: Sport;
  /** Recording id in the on-device library (feat/video-recording owns the store). */
  recordingId: string;
  /** Display names, e.g. { A: "Karan", B: "Opponent" }. */
  sides: Record<Side, string>;
  startedAt: string; // ISO 8601
  durationSec: number;
  status: MatchStatus;
  /** Ordered by tSec; the single source of truth the state machines fold. */
  events: ScoreEvent[];
}

// ---------------------------------------------------------------------------
// Squash (PRIMARY) — PAR-11: point-a-rally, first to 11, win by 2, best of 5
// ---------------------------------------------------------------------------

/** The service box the next serve is struck from. */
export type ServeBox = "left" | "right";

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

// ---------------------------------------------------------------------------
// Tennis (SECONDARY)
// ---------------------------------------------------------------------------

/** Tennis point score within a standard (non-tiebreak) game. */
export type TennisPoint = "0" | "15" | "30" | "40" | "AD";

export interface TennisConfig {
  /** Sets needed to win the match (2 = best of 3, 3 = best of 5). */
  setsToWin: 2 | 3;
  /** Games per set (6 standard). Kept explicit for short-format sets later. */
  gamesPerSet: number;
  /** First to this many points wins a tiebreak (7 standard), win by 2. */
  tiebreakTo: number;
}

export const DEFAULT_TENNIS_CONFIG: TennisConfig = {
  setsToWin: 2,
  gamesPerSet: 6,
  tiebreakTo: 7,
};

export interface TennisScore {
  sport: "tennis";
  config: TennisConfig;
  /** Current-game points. During a tiebreak see `tiebreakPoints` instead. */
  points: Record<Side, TennisPoint>;
  /** Games in the set currently being played. */
  games: Record<Side, number>;
  /** Sets won so far. */
  sets: Record<Side, number>;
  /** Completed sets as final game counts, oldest first (e.g. [{A:6,B:4}]). */
  setHistory: Record<Side, number>[];
  /** Non-null while a tiebreak is in progress. */
  tiebreakPoints: Record<Side, number> | null;
  /** Set once a side has won `config.setsToWin` sets. */
  winner: Side | null;
}

// ---------------------------------------------------------------------------
// Later sports — shapes reserved so the UI can switch exhaustively
// ---------------------------------------------------------------------------

/** Pickleball: traditional side-out scoring to 11, win by 2. */
export interface PickleballScore {
  sport: "pickleball";
  points: Record<Side, number>;
  /** Games won (matches are commonly best of 3). */
  games: Record<Side, number>;
  /** Only the serving side scores; server 1/2 matters in doubles. */
  serving: Side;
  serverNumber: 1 | 2;
  winner: Side | null;
}

/** Badminton: rally scoring to 21, win by 2, capped at 30; best of 3 games. */
export interface BadmintonScore {
  sport: "badminton";
  points: Record<Side, number>;
  games: Record<Side, number>;
  serving: Side;
  winner: Side | null;
}

/** Discriminated on `sport`, so UI can switch exhaustively. */
export type MatchScore = SquashScore | TennisScore | PickleballScore | BadmintonScore;

// ---------------------------------------------------------------------------
// The one shared interface every sport sits behind
// ---------------------------------------------------------------------------

/**
 * A pure score state machine for one sport. Callers (scoreboard UI, review
 * UX, server-side assembler) only ever talk to this interface via
 * `getScoreEngine(sport)` — adding pickleball/badminton later means writing a
 * new engine, not touching callers.
 *
 * Laws every engine must obey (enforced by the shared engine tests):
 * - `apply` never mutates its input and is total: events after the match is
 *   decided are no-ops, so trailing AI events stay harmless when a human
 *   correction shortens the match;
 * - `reduce(events)` === events folded over `apply` from `initial()` —
 *   corrections are just "edit the list and re-fold".
 */
export interface ScoreEngine<S extends MatchScore = MatchScore> {
  readonly sport: Sport;
  /** Fresh pre-first-rally state. */
  initial(): S;
  /** Fold one event into the state. */
  apply(state: S, event: ScoreEvent): S;
  /** Fold an ordered event stream from scratch. */
  reduce(events: readonly ScoreEvent[]): S;
  /** One-line scoreboard string for the current state. */
  summary(state: S): string;
}
