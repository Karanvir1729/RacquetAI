/**
 * Refereeing a VIDEO: turn an analysed match's shot stream into a scoreline.
 *
 * The live referee watches a camera and asks a human after every rally. This
 * file does the same job on a file that has already been analysed — same rally
 * rule, same last-striker heuristic, same PAR-11 fold — except that there is
 * nobody courtside to ask, so it scores the whole video in one pass and then
 * hands the result over for correction.
 *
 * ---------------------------------------------------------------------------
 * THE ACCURACY IS THE SAME ACCURACY, AND IT COMPOUNDS.
 * ---------------------------------------------------------------------------
 * Per rally the ceiling is the measured 72.7% ("the last player to strike the
 * ball won the rally", 8 of 11 hand-labelled rally ends, Wilson 95% CI
 * 43.4%–90.3%) — and that was an ORACLE, scored against the true last striker
 * read off the frames rather than against a detector's output.
 *
 * A scoreline is a FOLD of those calls, so the errors do not average out, they
 * accumulate: one wrong rally shifts every subsequent serve and hand-out. The
 * probability that an 11-rally game is entirely right is 0.727^11 ≈ 2%, which
 * is why `rallyConfidence` here reports the per-rally number and
 * `scorelineNote` says the fold is not to be trusted as a result. This screen
 * shows a RECONSTRUCTION with every rally listed and correctable, never a
 * final score presented as fact.
 *
 * Pure: no React, no native module, no file system. It takes shots and returns
 * rallies, so the arithmetic can be tested against hand-labelled footage
 * without a device in the loop.
 */
import type { PlayerId, ShotEvent } from "@/features/analysis/types";

import { PlayerNames, scoreWord } from "./announce";
import { HEURISTIC_CEILING } from "./liveClient";
import { applySquashRally, createSquashScore } from "./squash";
import { DEFAULT_SQUASH_CONFIG, OTHER_SIDE, ScoreEvent, Side, SquashScore } from "./types";

/**
 * Silence that ends a rally, in seconds. The same 4.5 s the native engine uses
 * (`LiveReferee.swift`'s `rallyGapS`) and for the same measured reason: 8 s on
 * the same archive footage produced 47 shots per "rally", which is not a rally.
 *
 * It is a per-venue constant, not a law — a hard court with a loud gallery
 * detects fewer shots and wants a longer gap. Exposed on the options so a
 * screen can offer it rather than hard-coding a number nobody can see.
 */
export const RALLY_GAP_SEC = 4.5;

/**
 * A rally that could not have been one: a single stray onset between two long
 * silences is a door, a bounce, or a ball being picked up, and counting it as
 * a rally awards a point for nothing. Two strikes is the floor for something
 * that was rallied at all — a serve and a return.
 */
export const MIN_RALLY_SHOTS = 2;

/** One reconstructed rally: when it ran, who hit last, how sure that is. */
export interface VideoRally {
  /** 1-based, in video order — the label the timeline row shows. */
  index: number;
  startSec: number;
  endSec: number;
  shots: number;
  /** The last player to strike. The proposed winner, never a proven one. */
  lastStriker: PlayerId;
  /** The side that rally was awarded to, after the A/B binding is applied. */
  winner: Side;
}

/**
 * The tracker's "Player A" is whoever the analyser labelled A — leftmost at
 * first detection, not a person. Binding it to a side is a human's job, and it
 * must be flippable after the fact, because a scoreline built on a swapped
 * binding is exactly right and completely backwards.
 */
export interface PlayerBinding {
  aIs: Side;
}

export const DEFAULT_PLAYER_BINDING: PlayerBinding = { aIs: "A" };

export function flipPlayerBinding(binding: PlayerBinding): PlayerBinding {
  return { aIs: OTHER_SIDE[binding.aIs] };
}

export function sideForPlayer(player: PlayerId, binding: PlayerBinding): Side {
  return player === "A" ? binding.aIs : OTHER_SIDE[binding.aIs];
}

export interface VideoRefereeOptions {
  /** Silence that separates two rallies. Defaults to `RALLY_GAP_SEC`. */
  gapSec?: number;
  /** Which analyser label is which side of the scoreboard. */
  binding?: PlayerBinding;
  /** Who served the first rally — nothing in the video reveals it. */
  firstServer?: Side;
}

export interface VideoRefereeResult {
  rallies: VideoRally[];
  /** The rallies that actually landed on the scoreboard, folded in order. */
  score: SquashScore;
  /**
   * Breaks in the shot stream that were dropped as too short to be a rally.
   * Surfaced, never silent: it is the honest half of "we found 42 rallies".
   */
  discarded: number;
  /** Rallies played after the match was already decided — ignored by the fold. */
  ignoredAfterMatch: number;
  firstServer: Side;
}

/**
 * Split a shot stream into rallies on silence. Shots are sorted first: the
 * analysis contract never promised an ordered list, and an out-of-order stream
 * would otherwise split one rally into several and mis-read who hit last.
 */
export function splitRallies(
  shots: readonly ShotEvent[],
  gapSec: number = RALLY_GAP_SEC,
): ShotEvent[][] {
  const ordered = [...shots].sort((a, b) => a.tSec - b.tSec);
  const rallies: ShotEvent[][] = [];
  let current: ShotEvent[] = [];
  for (const shot of ordered) {
    const previous = current.at(-1);
    if (previous !== undefined && shot.tSec - previous.tSec > gapSec) {
      rallies.push(current);
      current = [];
    }
    current.push(shot);
  }
  if (current.length > 0) rallies.push(current);
  return rallies;
}

/**
 * Referee a whole analysed video.
 *
 * The fold STOPS at match point. A recording usually runs on past the last
 * rally — knock-up for the next pair, a conversation, balls being collected —
 * and every one of those onsets would otherwise keep awarding points in a
 * match that was already over. They are counted (`ignoredAfterMatch`) rather
 * than hidden, because "we saw 9 more rallies after the match ended" is
 * evidence the rally rule is wrong for this footage.
 */
export function refereeVideo(
  shots: readonly ShotEvent[],
  options: VideoRefereeOptions = {},
): VideoRefereeResult {
  const {
    gapSec = RALLY_GAP_SEC,
    binding = DEFAULT_PLAYER_BINDING,
    firstServer = "A",
  } = options;

  const groups = splitRallies(shots, gapSec);
  const rallies: VideoRally[] = [];
  let discarded = 0;

  for (const group of groups) {
    const last = group.at(-1);
    const first = group[0];
    if (first === undefined || last === undefined) continue;
    if (group.length < MIN_RALLY_SHOTS) {
      discarded += 1;
      continue;
    }
    rallies.push({
      index: rallies.length + 1,
      startSec: first.tSec,
      endSec: last.tSec,
      shots: group.length,
      lastStriker: last.player,
      winner: sideForPlayer(last.player, binding),
    });
  }

  let score = createSquashScore(DEFAULT_SQUASH_CONFIG, firstServer);
  let ignoredAfterMatch = 0;
  for (const rally of rallies) {
    if (score.winner !== null) {
      ignoredAfterMatch += 1;
      continue;
    }
    score = applySquashRally(score, rally.winner);
  }

  return { rallies, score, discarded, ignoredAfterMatch, firstServer };
}

/**
 * The reconstruction as score events, so a refereed video can be loaded into
 * the same tap-driven screen and corrected rally by rally.
 *
 * `at` is the rally's video timestamp in milliseconds, not wall-clock: these
 * events describe a match that happened whenever the video was shot, and
 * stamping them "now" would make the Score keeper's resume window think a
 * three-week-old recording was a match in progress.
 */
export function toScoreEvents(result: VideoRefereeResult): ScoreEvent[] {
  const scored = result.rallies.slice(0, result.rallies.length - result.ignoredAfterMatch);
  return scored.map((rally) => ({
    id: `vid-${rally.index}`,
    at: Math.round(rally.endSec * 1000),
    kind: "rally",
    winner: rally.winner,
  }));
}

/**
 * The per-rally confidence, which is all this feature has. There is no
 * per-rally evidence in an analysis file to grade one rally above another —
 * every call rests on the same heuristic — so it is the flat ceiling, quoted
 * as the ceiling.
 */
export const rallyConfidence = HEURISTIC_CEILING;

/**
 * What the app SAYS when it finishes refereeing a video.
 *
 * It reads the score out loud like every other call on this screen — that is
 * the point of the feature — but it opens by naming where the score came from
 * and closes by asking for it to be checked. Nobody was courtside to catch a
 * wrong rally, so the sentence must not sound like a marker's call, which is
 * why it lives here beside the compounding note and not in announce.ts.
 */
export function videoResultCall(
  score: SquashScore,
  names: PlayerNames,
  rallies: number,
): string {
  const opener = `${rallies} ${rallies === 1 ? "rally" : "rallies"} scored from the video.`;
  const check = "Check it against what you remember.";
  if (score.winner !== null) {
    return `${opener} That gives the match to ${names[score.winner]}, ${gamesCall(score)}. ${check}`;
  }
  return `${opener} That leaves it ${standingCall(score, names)}. ${check}`;
}

/**
 * Where the match stands, LEADER FIRST.
 *
 * Deliberately not `scoreCall` from announce.ts, which puts the SERVER's score
 * first — the marker's convention, and correct in a rally-by-rally flow where
 * everyone present knows who is serving. Read out once at the end of a video it
 * is a trap: "Sam ahead, one, two" is what the marker's order produces when Sam
 * leads 2-1 and the other player is serving, and it sounds exactly like the
 * opposite of what it means.
 */
function standingCall(score: SquashScore, names: PlayerNames): string {
  const { A, B } = score.points;
  const games = gamesStandingCall(score, names);
  if (A === B) return `level at ${scoreWord(A)} all${games}`;
  const lead: Side = A > B ? "A" : "B";
  const trail = OTHER_SIDE[lead];
  return `${names[lead]} ahead, ${scoreWord(score.points[lead])} ${scoreWord(score.points[trail])}${games}`;
}

/** ", two games to one" — omitted entirely in a match still in its first game. */
function gamesStandingCall(score: SquashScore, names: PlayerNames): string {
  const { A, B } = score.games;
  if (A === 0 && B === 0) return "";
  if (A === B) return `, ${numberWord(A)} ${A === 1 ? "game" : "games"} all`;
  const lead: Side = A > B ? "A" : "B";
  const won = score.games[lead];
  const lost = score.games[OTHER_SIDE[lead]];
  return `, ${names[lead]} ${numberWord(won)} ${won === 1 ? "game" : "games"} to ${numberWord(lost)}`;
}

/** "two games to one" / "three games to nil", for a decided match. */
function gamesCall(score: SquashScore): string {
  const winner = score.winner;
  if (winner === null) return "";
  const won = score.games[winner];
  const lost = score.games[OTHER_SIDE[winner]];
  return `${numberWord(won)} ${won === 1 ? "game" : "games"} to ${numberWord(lost)}`;
}

/** Spelled out so a voice cannot read "3-1" as a decimal — announce.ts's rule. */
function numberWord(count: number): string {
  return ["nil", "one", "two", "three", "four", "five"][count] ?? String(count);
}

/**
 * What to print above a reconstructed scoreline. It names the compounding
 * explicitly: a reader who sees "11-8" will believe it unless told plainly why
 * they should not.
 */
export function scorelineNote(rallies: number): string {
  const pct = Math.round(rallyConfidence * 100);
  // Two lines on a 375pt phone. The long version of this warning is on the
  // picker, which is where somebody is still deciding whether to trust it.
  return (
    `${rallies} ${rallies === 1 ? "rally" : "rallies"} found, each given to whoever hit last — ` +
    `right ${pct}% of the time, and errors add up. A draft to correct, not a result.`
  );
}
