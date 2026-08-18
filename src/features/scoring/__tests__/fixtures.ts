/**
 * Event builders for scoring tests. Not a test file itself (jest only picks
 * up *.test.ts). Ids and timestamps are monotonic so a built stream looks like
 * one a real session would produce, without every test hand-writing them.
 */

import {
  LetDecisionEvent,
  LetRuling,
  RallyEndEvent,
  ServeBox,
  ServeBoxEvent,
  Side,
} from "../types";

let seq = 0;

/** Fixed epoch base so ids and timestamps stay readable in failure output. */
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

function next(): { id: string; at: number } {
  seq += 1;
  return { id: `e${seq}`, at: T0 + seq * 30_000 };
}

/** A completed rally won by `winner`. */
export function rally(winner: Side): RallyEndEvent {
  return { kind: "rally", ...next(), winner };
}

/** An interference appeal by `appealer`, ruled `ruling`. */
export function decision(appealer: Side, ruling: LetRuling): LetDecisionEvent {
  return { kind: "let-decision", ...next(), appealer, ruling };
}

/** The incoming server choosing a box. */
export function boxChoice(box: ServeBox): ServeBoxEvent {
  return { kind: "serve-box", ...next(), box };
}
