/**
 * Scoring domain model — the contract between the future AI pipeline and the
 * app. The pipeline (docs/03-ai-scoring-plan.md) emits `ScoreEvent`s; the pure
 * per-sport state machines (tennis.ts today, pickleball/badminton later) fold
 * them into a `MatchScore`. Nothing in this file touches React Native, the
 * network, or any model runtime — it is plain data + types so the same code
 * runs in the app, in tests, and in the server-side results assembler.
 */

export type Sport = "tennis" | "pickleball" | "badminton";

/** The two opposing sides. Doubles is still two sides; players hang off the side. */
export type Side = "A" | "B";

export const OTHER_SIDE: Record<Side, Side> = { A: "B", B: "A" };

/** Where a score event came from — the correction UX depends on this. */
export type ScoreEventSource = "ai" | "human";

/**
 * One point, attributed to a side, anchored to a moment in the match video.
 * This is the pipeline's unit of output: everything downstream (game/set/match
 * score, timeline scrubbing, highlights) derives from an ordered list of these.
 */
export interface ScoreEvent {
  id: string;
  /** Which side won the point/rally. */
  winner: Side;
  /** Seconds into the source video where the point ended (rally end). */
  tSec: number;
  /** Model confidence in the attribution, 0..1. Human corrections carry 1. */
  confidence: number;
  source: ScoreEventSource;
  /**
   * If a human corrected an AI event, the id of the AI event it replaces —
   * kept so corrections are an audit trail, not a destructive edit.
   */
  corrects?: string;
}

/** Below this confidence the app queues the point for human review. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

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
// Per-sport score state shapes
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
export type MatchScore = TennisScore | PickleballScore | BadmintonScore;
