/**
 * What the court-watcher SAYS and SHOWS when it thinks a rally has ended.
 *
 * Pure strings, no React and no native module, for the same reason announce.ts
 * is: the wording is the part that can be wrong in a way nobody notices, so it
 * has to be testable on its own.
 *
 * ---------------------------------------------------------------------------
 * EVERY LINE IN HERE IS A QUESTION. THAT IS NOT A STYLE CHOICE.
 * ---------------------------------------------------------------------------
 * Hand-labelling rally ends on three archive matches put "the last player to
 * strike the ball won the rally" at 8 of 11 — 72.7%, Wilson 95% CI 43.4%–90.3%.
 * Three separate things push the shipped number BELOW that:
 *
 *   - it is an ORACLE figure, scored against the true last striker read off the
 *     frames, which the on-device detector does not match;
 *   - it is conditioned on the rally ends that were readable at all, and 21% of
 *     real ends were not;
 *   - rally-end detection misfires independently — 1 of 15 inspected breaks was
 *     mid-rally, so some questions arrive while the point is still being played.
 *
 * So the app never states a result it inferred. `announce.ts` makes the
 * marker's call once a human has decided; this file only ever asks. A wrong
 * call spoken with a marker's certainty is worse than no referee at all, and
 * this file is where that promise is kept or broken.
 */
import { PlayerNames, scoreCall } from "./announce";
import {
  sideForTrack,
  type LiveTrackId,
  type RallyProposal,
  type TrackBinding,
} from "./liveClient";
import { applySquashRally } from "./squash";
import { SquashScore } from "./types";

/**
 * How much of the screen to give the suggestion.
 *
 * - `suggest` — name the player and light up their button, still a question;
 * - `ask` — name nothing; the two buttons stand equal and the human chooses.
 *
 * The native engine's `confirm` band (>= 0.85) is deliberately unreachable: the
 * confidence is capped at the 0.727 measured ceiling, so nothing can ever get
 * there. It is mapped to `suggest` anyway rather than left to fall through,
 * because if a future measurement raises the ceiling the correct behaviour is
 * still "light up the button and ask", never "commit on a timer".
 */
export type ProposalLevel = "suggest" | "ask";

export function proposalLevel(proposal: RallyProposal, playResumed: boolean): ProposalLevel {
  // Play carried on after the question was asked, so the break was probably not
  // a rally end at all. Whatever the confidence said, stop leaning on a player.
  if (playResumed) return "ask";
  if (proposal.winner === null) return "ask";
  return proposal.recommendation === "ask" ? "ask" : "suggest";
}

/**
 * The headline, in the largest type the prompt has. Short enough to read from a
 * metre away in the two seconds before the next serve.
 */
export function proposalQuestion(
  proposal: RallyProposal,
  names: PlayerNames,
  level: ProposalLevel,
): string {
  if (level === "ask" || proposal.winner === null) return "Who won that rally?";
  return `Point to ${names[proposal.winner]}?`;
}

/**
 * The supporting line under the headline — what was seen, in one clause.
 *
 * At `ask` level with a named player this is the only place the suggestion
 * appears: still useful information, phrased so it cannot be mistaken for a
 * call.
 */
export function proposalSubtitle(
  proposal: RallyProposal,
  names: PlayerNames,
  level: ProposalLevel,
  playResumed: boolean,
): string {
  if (playResumed) return "They are playing again — this may not have been the end of a rally.";
  if (proposal.winner === null) return "The last shot could not be pinned to either player.";
  if (level === "ask")
    return `The last shot looked like ${names[proposal.winner]}'s, but only just.`;
  return `${names[proposal.winner]} appears to have hit last. Tap whoever actually won it.`;
}

/**
 * The spoken line: the question, then the score it WOULD make.
 *
 * Two rules hold this together. It always ends in a question mark, and it never
 * uses the marker's forms from announce.ts — no "hand out", no bare "five,
 * three". A player who half-hears this must not be able to mistake it for the
 * call, because the call only happens after somebody taps.
 *
 * Returns null when there is nothing to ask: the match is already decided.
 */
export function proposalCall(
  before: SquashScore,
  proposal: RallyProposal,
  names: PlayerNames,
  level: ProposalLevel,
): string | null {
  if (before.winner !== null) return null;
  // Neither branch below names a player. The VOICE must agree with the SCREEN:
  // at `ask` the screen deliberately shows two equal buttons, and a spoken
  // "Point to Priya?" would put a name in the players' heads that the display
  // is pointedly withholding. The no-striker case keeps its own wording
  // because WHY it cannot say is worth hearing.
  if (proposal.winner === null) return "Rally over? I could not tell who hit last.";
  if (level === "ask") return "Rally over? Who won that one?";

  const winner = proposal.winner;
  const after = applySquashRally(before, winner);
  const opener = `Point to ${names[winner]}?`;

  if (after.winner !== null) return `${opener} That would be the match to ${names[winner]}.`;
  if (after.games[winner] > before.games[winner]) {
    return `${opener} That would be game to ${names[winner]}.`;
  }
  return `${opener} That would be ${scoreCall(after)}.`;
}

/**
 * The engine's own explanation, with the tracker's "Player A"/"Player B" turned
 * into the names on the scoreboard.
 *
 * ONE pass, not two chained `replace` calls: with the default names and a
 * swapped binding, replacing A→B and then B→A maps both tracks onto the same
 * player and the sentence quietly becomes false.
 */
export function humanizeWhy(why: string, binding: TrackBinding, names: PlayerNames): string {
  return why.replace(
    /\bPlayer (A|B)\b/g,
    (_match, id: string) => names[sideForTrack(id as LiveTrackId, binding)],
  );
}

/**
 * The confidence, spelled out where a curious human has gone looking for it.
 *
 * The ceiling is quoted alongside it every time. A bare "41%" invites the
 * reading that 100% is available with better tuning; it is not, and saying so
 * is the difference between an honest number and a misleading one.
 */
export function confidenceLine(proposal: RallyProposal): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  return (
    `Confidence ${pct(proposal.confidence)}, which can never exceed ${pct(proposal.ceiling)} — ` +
    "that is how often the last player to hit turned out to have won, on hand-labelled footage."
  );
}

/**
 * The standing disclaimer on the entry point. Deliberately the first thing said
 * about the feature, and deliberately not a boast.
 */
export const WATCH_PITCH = "It spots the end of a rally and asks who won. You decide every point.";

/**
 * The measured truth, kept one tap from the prompt rather than buried in a
 * settings screen.
 */
export const WATCH_ACCURACY_NOTE =
  "On hand-labelled footage the last player to hit had won 8 rallies out of 11, and that was a " +
  "best case. The ball is never tracked, so the app cannot see why a rally ended. Check every " +
  "suggestion before you tap.";
