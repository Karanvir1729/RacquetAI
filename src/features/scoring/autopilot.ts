/**
 * Autopilot: the rule for when the app is allowed to score a rally by itself,
 * and every word it says while doing it.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE FILE THAT LETS A MACHINE CHANGE THE SCORE.
 * ---------------------------------------------------------------------------
 * Everywhere else in features/scoring, a point exists because a human tapped.
 * Autopilot is the deliberate exception, and it is fenced by three rules that
 * are all measured, not stylistic:
 *
 * 1. It is OFF until a person turns it on, and the switch says in plain words
 *    what turning it on means.
 * 2. It only ever commits a `suggest`-level proposal. When the engine lands on
 *    `ask` — the last striker was unreadable (21% of real rally ends), the
 *    confidence was below the propose band, or play carried on after the
 *    question (1 of 15 inspected breaks was mid-rally) — there is nothing to
 *    commit and it goes back to asking. Autopilot never guesses harder than
 *    the evidence; it just stops waiting for a tap when the evidence is there.
 * 3. It waits `AUTOPILOT_DELAY_MS` in full view, counting down, and ANY tap
 *    wins. The countdown is the safety rail: at the measured 72.7% ceiling
 *    roughly one rally in four is scored to the wrong player, so the point of
 *    the pause is that a human standing there can always beat it.
 *
 * Pure — no React, no timers, no native module. The screen owns the clock; this
 * file owns the decision and the wording, so both can be tested without one.
 */
import type { RallyProposal } from "./liveClient";
import type { ProposalLevel } from "./proposal";
import type { Side } from "./types";

/**
 * How long the countdown runs.
 *
 * Four seconds, and the number is a compromise between two real costs. The
 * proposal already arrives ~6 s after the last strike (a 4.5 s silence
 * threshold plus a 1.6 s gate delay), so anything longer and the score lands
 * after the next serve; anything shorter and a player walking back to the
 * service box cannot reach the phone in time to correct it.
 */
export const AUTOPILOT_DELAY_MS = 4000;

/**
 * The winner autopilot would commit, or null when it must keep asking.
 *
 * Null is the common case and must stay that way: `ask` covers every branch
 * where the engine could not read the rally, and no amount of autopilot makes
 * an unreadable rally readable.
 */
export function autopilotWinner(
  proposal: RallyProposal | null,
  level: ProposalLevel,
  enabled: boolean,
): Side | null {
  if (!enabled) return null;
  if (proposal === null) return null;
  if (level !== "suggest") return null;
  return proposal.winner;
}

/** Whole seconds left, for the countdown label. Never below zero. */
export function secondsLeft(elapsedMs: number, delayMs: number = AUTOPILOT_DELAY_MS): number {
  return Math.max(0, Math.ceil((delayMs - elapsedMs) / 1000));
}

/**
 * The line under the question while the clock runs. It names the player being
 * given the point and the way out, in that order — a countdown that does not
 * say what it is about to do is just a number ticking down.
 */
export function countdownLabel(name: string, seconds: number): string {
  if (seconds <= 0) return `Scoring to ${name}…`;
  return `Scoring to ${name} in ${seconds} — tap the other player to correct`;
}

/**
 * What a rally the app scored by itself looks like on the call line, once the
 * marker's call has been spoken. The screen shows this beside the score so a
 * player scrolling back can tell which points nobody confirmed.
 */
export const AUTOPILOT_TAG = "Scored by autopilot";

/**
 * The "Watch live" caption while autopilot is armed. `WATCH_PITCH` — "it asks
 * who won, you decide every point" — becomes false the moment the switch is on,
 * and a pitch that is false is the one thing this feature cannot ship.
 */
export const AUTOPILOT_PITCH =
  "It spots the end of a rally and scores it after a countdown you can beat.";

export const AUTOPILOT_OFF_NOTE =
  "The camera asks who won each rally. Your tap is what scores the point.";

/**
 * The ON caption. It quotes the measured rate as a frequency of being WRONG,
 * because "73% accurate" reads as a pass mark and "wrong about one rally in
 * four" is the same number said in a way a user can act on.
 */
export const AUTOPILOT_ON_NOTE =
  "The camera scores each rally on its own after a 4-second countdown. It gets " +
  "roughly one rally in four wrong, so watch the score and correct it.";

/** Spoken once, when autopilot is armed mid-match. Warned, not sold. */
export const AUTOPILOT_ARMED_CALL =
  "Autopilot on. I will score each rally myself — correct me on the buttons.";
