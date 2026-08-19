/**
 * Where a video's score is at a given moment of playback, and what to say when
 * it moves.
 *
 * `videoReferee.ts` decides WHO won each rally and WHEN in the footage it
 * ended. This file answers the playback question on top of that: at playhead
 * time t, how many of those rallies have happened?
 *
 * ---------------------------------------------------------------------------
 * THE SCORE IS A FOLD OF TIME, NOT A CURSOR THAT ONLY GOES FORWARD.
 * ---------------------------------------------------------------------------
 * "Every rally whose end has been passed" is a pure function of t, so scrubbing
 * backwards puts the score back where it was at that moment, and scrubbing
 * forwards catches it up in one step. A cursor that only increments would
 * survive normal play and then be silently, permanently wrong the first time
 * anybody dragged the scrubber back to look at a rally again — on a scoreboard
 * that is the worst class of bug, because nothing on screen looks broken.
 *
 * Pure: no React, no player, no speech. The screen owns the playhead; this owns
 * the arithmetic and the wording.
 */
import { PlayerNames, buildAnnouncement } from "./announce";
import { applySquashRally, createSquashScore } from "./squash";
import { DEFAULT_SQUASH_CONFIG, ScoreEvent, Side, SquashScore } from "./types";
import { VideoRally, VideoRefereeResult } from "./videoReferee";

/**
 * How long after a rally's last strike the call lands.
 *
 * The rally is over before its last detected sound stops mattering — the ball
 * is picked up, the players walk back — so calling the score the instant the
 * final strike is heard steps on the rally that is still visibly ending. A
 * beat later reads as a marker who watched the point finish.
 *
 * Kept well under the 4.5 s rally gap so the call can never slide past the
 * start of the next rally.
 */
export const CALL_DELAY_SEC = 1.2;

/** When rally `index` (1-based) is called, in video time. */
export function callTime(rally: VideoRally): number {
  return rally.endSec + CALL_DELAY_SEC;
}

/**
 * How many rallies have been called by time `t`.
 *
 * Rallies are in video order, so this is a count of `callTime <= t`. It is
 * deliberately a scan rather than a stored index: the answer must depend only
 * on `t`, so that seeking anywhere — forward, back, or to the same spot twice —
 * produces the same score every time.
 */
export function calledBy(rallies: readonly VideoRally[], t: number): number {
  let count = 0;
  for (const rally of rallies) {
    if (callTime(rally) > t) break;
    count += 1;
  }
  return count;
}

/**
 * The score after the first `count` rallies — the same fold the tap-driven
 * screen does, stopped at match point exactly as `refereeVideo` stops.
 */
export function scoreAfter(
  rallies: readonly VideoRally[],
  count: number,
  firstServer: Side,
): SquashScore {
  let score = createSquashScore(DEFAULT_SQUASH_CONFIG, firstServer);
  for (const rally of rallies.slice(0, count)) {
    if (score.winner !== null) break;
    score = applySquashRally(score, rally.winner);
  }
  return score;
}

/** The events for the first `count` rallies, for the ordinary match sidecar. */
export function eventsAfter(rallies: readonly VideoRally[], count: number): ScoreEvent[] {
  return rallies.slice(0, count).map((rally) => ({
    id: `vid-${rally.index}`,
    // Video time in ms, not wall clock: these rallies happened whenever the
    // footage was shot. `useRefereeMatch` takes the match's own startedAt into
    // account when deciding whether a stored match is still resumable.
    at: Math.round(rally.endSec * 1000),
    kind: "rally" as const,
    winner: rally.winner,
  }));
}

export interface PlaybackStep {
  /** Rallies called by the new time. Drives the scoreboard. */
  called: number;
  /** The score to show. */
  score: SquashScore;
  /**
   * The line to speak, or null. Null covers three distinct cases and they all
   * have to stay silent: nothing new was crossed, the playhead moved backwards,
   * or so many rallies were skipped at once that no single call is true.
   */
  say: string | null;
  /**
   * True when the move was a jump rather than play — the screen uses it to
   * show "caught up to 7-5" instead of pretending a rally was just played.
   */
  jumped: boolean;
}

/**
 * How many rallies may be crossed in one update and still be spoken.
 *
 * One. A `timeUpdate` interval is a fraction of a second and a rally is at
 * least the 4.5 s gap long, so in ordinary playback exactly one rally can land
 * per update. More than one means the user seeked, and the only honest thing
 * to say then is nothing: the marker's call for the LAST of them describes a
 * score the listener never heard build, and the calls for the others are
 * already stale by the time the sentence starts.
 */
const MAX_SPOKEN_STEP = 1;

/**
 * Advance from `previousCalled` rallies to whatever `t` implies, and decide
 * what is said.
 *
 * The predicate is a comparison of two COUNTS, not "did we cross rally n" —
 * a coarse `timeUpdate` interval, a dropped frame, or a seek can move the
 * playhead past several rally ends between two samples, and a crossing test
 * written against a single expected rally silently loses every one it skipped.
 */
export function advance(
  result: VideoRefereeResult,
  previousCalled: number,
  t: number,
  names: PlayerNames,
): PlaybackStep {
  const called = calledBy(result.rallies, t);
  const score = scoreAfter(result.rallies, called, result.firstServer);
  const step = called - previousCalled;

  if (step <= 0) {
    // Unchanged, or the playhead went backwards. Rewinding is not an event to
    // announce; the scoreboard simply reads what it read at that moment.
    return { called, score, say: null, jumped: step < 0 };
  }

  if (step > MAX_SPOKEN_STEP) {
    return { called, score, say: null, jumped: true };
  }

  const rally = result.rallies[called - 1];
  if (rally === undefined) return { called, score, say: null, jumped: false };

  // The match was already decided before this rally: `scoreAfter` stops folding
  // at match point, so there is no new call to make and saying one would
  // announce a score that is not on the board.
  const before = scoreAfter(result.rallies, called - 1, result.firstServer);
  if (before.winner !== null) return { called, score, say: null, jumped: false };

  const event = eventsAfter(result.rallies, called).at(-1);
  if (event === undefined) return { called, score, say: null, jumped: false };

  // The SAME announcement builder the tap-driven screen uses. A rally called
  // off a video and a rally called off a thumb are the same call — hand out,
  // game ball, game to X — and having a second wording for one of them is how
  // the two drift apart.
  return { called, score, say: buildAnnouncement(before, event, score, names), jumped: false };
}

/** Whole seconds of footage still to play, for the progress read-out. */
export function remainingRallies(result: VideoRefereeResult, called: number): number {
  return Math.max(0, result.rallies.length - called);
}

/**
 * Where to seek to replay the rally that is about to be called next, so a demo
 * does not sit through the walk back to the service box. Returns null when
 * there is nothing left to skip to.
 */
export function nextRallyStart(result: VideoRefereeResult, called: number): number | null {
  const next = result.rallies[called];
  if (next === undefined) return null;
  // The start of the rally, not its end: the point of skipping is to watch the
  // rally that produces the call, not to arrive after it.
  return Math.max(0, next.startSec - 1);
}

/**
 * What the app says when a playable video is loaded, BEFORE any of it has been
 * scored.
 *
 * The one-pass path's sentence (`videoResultCall`) reads out a finished
 * scoreline, which here would be a lie by three minutes — nothing has been
 * called yet. This one says what is about to happen and who is in charge of
 * it, and it is the last thing said before the app starts calling points on
 * its own.
 */
export function playbackLoadCall(rallies: number): string {
  if (rallies === 0) return "I could not find any rallies in this video.";
  const count = `${rallies} ${rallies === 1 ? "rally" : "rallies"}`;
  return `${count} found. I will call each one as the video reaches it — correct me on the buttons.`;
}

/**
 * What the screen says while a video is playing itself out. Deliberately not a
 * score — the scoreboard is right there — but the thing a viewer cannot see:
 * how much of this the app has decided on its own.
 */
export function playbackNote(called: number, total: number): string {
  if (total === 0) return "No rallies were found in this video.";
  if (called === 0) return `Ready — ${total} rallies to call. Press play.`;
  if (called >= total) return `All ${total} rallies called. Correct any of them on the buttons.`;
  return `Rally ${called} of ${total}, called by the app as it plays.`;
}
