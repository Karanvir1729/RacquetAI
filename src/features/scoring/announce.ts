/**
 * What the Score keeper says out loud — pure string building, no speech
 * engine. Separating the wording from the speaking is what makes the calls
 * testable, and it means the same line can be shown on screen for anyone who
 * has the sound muted (which is the default courtside etiquette).
 *
 * The wording follows the squash marker's convention:
 * - the SERVER's score is always called first ("five, three"), because the
 *   score is read from the hand that is about to serve;
 * - equal scores are "all" ("eight all"), and zero is "love";
 * - a change of hand is announced before the score ("hand out, two, five");
 * - a rally that ends one point from the game gets "game ball" after the
 *   score, or "match ball" when that game would take the match.
 *
 * Numbers are spelled out rather than left as digits: a text-to-speech voice
 * handed "10, 8" is liable to read "ten eight" as a year or a decimal, and
 * mis-hearing the score is the exact failure this feature exists to prevent.
 */

import { OTHER_SIDE, ScoreEvent, Side, SIDES, SquashScore } from "./types";

/** Display names for the two sides; also what gets spoken. */
export type PlayerNames = Record<Side, string>;

export const DEFAULT_PLAYER_NAMES: PlayerNames = { A: "Player A", B: "Player B" };

// Squash calls zero "love". Beyond the table, fall back to digits — a 31-29
// game has never been played, but a wrong word is worse than a plain number.
const NUMBER_WORDS = [
  "love",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

/** Spoken form of a point count. Defensive: junk in gives a plain numeral. */
export function scoreWord(points: number): string {
  if (!Number.isInteger(points) || points < 0) return String(points);
  return NUMBER_WORDS[points] ?? String(points);
}

/** "love all" / "eight all" / "five, three" — server's score first. */
export function scoreCall(score: SquashScore): string {
  const serverPoints = score.points[score.server];
  const receiverPoints = score.points[OTHER_SIDE[score.server]];
  if (serverPoints === receiverPoints) return `${scoreWord(serverPoints)} all`;
  return `${scoreWord(serverPoints)}, ${scoreWord(receiverPoints)}`;
}

/**
 * The side one rally away from winning the current game, or null. At most one
 * side can be there at a time: at 10-10 nobody is (11-10 is not a game).
 */
export function gameBallSide(score: SquashScore): Side | null {
  if (score.winner !== null) return null;
  for (const side of SIDES) {
    const next = score.points[side] + 1;
    if (next >= score.config.pointsPerGame && next - score.points[OTHER_SIDE[side]] >= 2) {
      return side;
    }
  }
  return null;
}

/** "one game to love" / "two games to one" / "one game all". */
function gamesPhrase(score: SquashScore, leader: Side): string {
  const won = score.games[leader];
  const lost = score.games[OTHER_SIDE[leader]];
  const unit = won === 1 ? "game" : "games";
  return won === lost
    ? `${scoreWord(won)} ${unit} all`
    : `${scoreWord(won)} ${unit} to ${scoreWord(lost)}`;
}

/** The side whose game tally grew between two states, if any. */
function gameWinner(before: SquashScore, after: SquashScore): Side | null {
  return SIDES.find((side) => after.games[side] > before.games[side]) ?? null;
}

/**
 * Joins fragments into one line: "Hand out. Two, five."
 *
 * Each fragment is capitalised and full-stopped. The voice does not care, but
 * the same string is drawn on screen for anyone scoring with the sound off,
 * and "hand out. two, five" reads like a bug.
 */
function sentence(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    // charAt, not part[0]: the non-empty filter above already guarantees an
    // index 0, but the web app compiles this same file under
    // noUncheckedIndexedAccess, where the indexed read is `string | undefined`.
    // charAt is total and reads the same.
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}.`)
    .join(" ");
}

/** Opening call of a match or a new game: who serves, from love all. */
export function matchStartCall(names: PlayerNames, firstServer: Side): string {
  return sentence([`${names[firstServer]} to serve`, "Love all"]);
}

/**
 * Spoken after an undo. The prefix matters: without it a player who half-heard
 * the previous call has no way to tell a correction from a new rally.
 */
export function correctionCall(score: SquashScore, names: PlayerNames): string {
  if (score.winner !== null) {
    return sentence(["Correction", `Match to ${names[score.winner]}`]);
  }
  return sentence(["Correction", scoreCall(score)]);
}

/**
 * The line to speak for one applied event, or null when there is nothing worth
 * saying (a box choice, or a stray tap after the match is already decided).
 *
 * Takes the state on both sides of the event because every interesting call is
 * about the TRANSITION — a handout is "the server changed", a game is "the
 * game tally grew" — not about the state alone.
 */
export function buildAnnouncement(
  before: SquashScore,
  event: ScoreEvent,
  after: SquashScore,
  names: PlayerNames = DEFAULT_PLAYER_NAMES,
): string | null {
  // The match was already over, so the reducer ignored this event. Saying the
  // result again would imply the tap counted.
  if (before.winner !== null) return null;

  // Picking a service box is visible on screen and changes no score.
  if (event.kind === "serve-box") return null;

  if (after.winner !== null) {
    return sentence([`Match to ${names[after.winner]}`, gamesPhrase(after, after.winner)]);
  }

  const gameTaken = gameWinner(before, after);
  if (gameTaken !== null) {
    return sentence([`Game to ${names[gameTaken]}`, gamesPhrase(after, gameTaken)]);
  }

  const parts: string[] = [];
  if (event.kind === "let-decision") {
    // A let replays the rally: nothing moves, so the score call is a reminder
    // rather than news, and the ruling itself is the announcement.
    if (event.ruling === "let") return sentence(["Yes let", scoreCall(after)]);
    parts.push(event.ruling === "stroke" ? `Stroke to ${names[event.appealer]}` : "No let");
  }

  // Change of hand, called before the score the new server will play to.
  if (after.server !== before.server) parts.push("Hand out");
  parts.push(scoreCall(after));

  const ball = gameBallSide(after);
  if (ball !== null) {
    const takesMatch = after.games[ball] + 1 >= after.config.gamesToWin;
    const call = takesMatch ? "Match ball" : "Game ball";
    // Unqualified, the call belongs to the server — that is how a marker says
    // it. When it is the RECEIVER who is one point away, the name has to come
    // with it or the players will hear it as the server's game ball.
    parts.push(ball === after.server ? call : `${call}, ${names[ball]}`);
  }

  return sentence(parts);
}
