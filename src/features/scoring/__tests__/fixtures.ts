/**
 * Event builders for scoring tests. Not a test file itself (jest only picks
 * up *.test.ts). Ids/timestamps are monotonic so streams look like real
 * pipeline output without every test hand-writing bookkeeping fields.
 */

import { LetDecisionEvent, LetRuling, RallyEndEvent, ScoreEventSource, Side } from "../types";

let seq = 0;

interface FixtureOverrides {
  confidence?: number;
  source?: ScoreEventSource;
  corrects?: string;
}

/** A completed rally won by `winner`. Defaults to a fully-confident human event. */
export function rally(winner: Side, overrides: FixtureOverrides = {}): RallyEndEvent {
  seq += 1;
  return {
    kind: "rally",
    id: `e${seq}`,
    tSec: seq * 30,
    confidence: 1,
    source: "human",
    winner,
    ...overrides,
  };
}

/** An interference appeal by `appealer`, ruled `ruling`. */
export function decision(
  appealer: Side,
  ruling: LetRuling,
  overrides: FixtureOverrides = {},
): LetDecisionEvent {
  seq += 1;
  return {
    kind: "let-decision",
    id: `e${seq}`,
    tSec: seq * 30,
    confidence: 1,
    source: "human",
    appealer,
    ruling,
    ...overrides,
  };
}
