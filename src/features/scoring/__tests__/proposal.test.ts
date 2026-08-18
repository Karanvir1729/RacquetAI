/**
 * The wording of the question.
 *
 * This is the file that decides whether the app is honest. The scoring engine
 * cannot be wrong about the score, but a sentence CAN be wrong about how sure
 * the app is, and nobody courtside would ever notice — they would just hear
 * something that sounded like a call and believe it.
 *
 * So the properties pinned here are:
 * - every spoken proposal is a question, and never uses the marker's forms that
 *   announce.ts reserves for a decision a human has actually made;
 * - the suggestion is dropped, not merely softened, whenever the evidence for
 *   it is weak or the players have carried on playing;
 * - the tracker's "Player A" is mapped onto the right human even when the
 *   binding is swapped AND the players are still called Player A and Player B.
 */
import { DEFAULT_PLAYER_NAMES, PlayerNames } from "../announce";
import type { RallyProposal } from "../liveClient";
import {
  confidenceLine,
  humanizeWhy,
  proposalCall,
  proposalLevel,
  proposalQuestion,
  proposalSubtitle,
  WATCH_ACCURACY_NOTE,
  WATCH_PITCH,
} from "../proposal";
import { createSquashScore } from "../squash";
import { Side, SquashScore } from "../types";

const NAMES: PlayerNames = { A: "Sam", B: "Alex" };

function proposal(overrides: Partial<RallyProposal> = {}): RallyProposal {
  return {
    winner: "A",
    confidence: 0.6,
    recommendation: "propose",
    why: "Player A struck last, then 4.5 s with no detected shot (threshold 4.5 s).",
    gapS: 4.5,
    strikes: 7,
    ceiling: 0.727,
    lastStrikeT: 22.5,
    decidedAtT: 27,
    at: 1_000,
    ...overrides,
  };
}

function scoreAt(points: Record<Side, number>, games: Record<Side, number>): SquashScore {
  return { ...createSquashScore(), points, games };
}

describe("how hard the app leans on its own suggestion", () => {
  it("names a player when the engine is above its own propose band", () => {
    expect(proposalLevel(proposal(), false)).toBe("suggest");
  });

  it("names nobody once the engine says ask", () => {
    expect(proposalLevel(proposal({ recommendation: "ask", confidence: 0.3 }), false)).toBe("ask");
  });

  it("names nobody when the last striker could not be read at all", () => {
    // 21% of real rally ends were unreadable in the labelling pass. They have
    // to arrive as an open question, not as a coin flip dressed up as a call.
    expect(proposalLevel(proposal({ winner: null }), false)).toBe("ask");
  });

  it("drops the suggestion when the players carried on playing", () => {
    // 1 of 15 inspected breaks was mid-rally. If shots keep landing after the
    // question, the break was probably never a rally end.
    expect(proposalLevel(proposal(), true)).toBe("ask");
  });

  it("still only asks in the confirm band, which is unreachable anyway", () => {
    // The native confidence is capped at the 0.727 ceiling, so nothing can ever
    // land here. If a future measurement raises the cap, the right behaviour is
    // still to light the button up and wait — never to commit on a timer.
    expect(proposalLevel(proposal({ recommendation: "confirm", confidence: 0.9 }), false)).toBe(
      "suggest",
    );
  });
});

describe("what is written on screen", () => {
  it("asks about the named player when it is leaning", () => {
    expect(proposalQuestion(proposal(), NAMES, "suggest")).toBe("Point to Sam?");
  });

  it("asks an open question when it is not", () => {
    expect(proposalQuestion(proposal(), NAMES, "ask")).toBe("Who won that rally?");
  });

  it("never states a winner, in any state", () => {
    for (const level of ["suggest", "ask"] as const) {
      for (const winner of ["A", "B", null] as const) {
        expect(proposalQuestion(proposal({ winner }), NAMES, level)).toMatch(/\?$/);
      }
    }
  });

  it("keeps the suggestion visible as information once it stops leaning", () => {
    const subtitle = proposalSubtitle(proposal(), NAMES, "ask", false);
    expect(subtitle).toContain("Sam");
    expect(subtitle).toContain("only just");
  });

  it("says outright when play has resumed", () => {
    expect(proposalSubtitle(proposal(), NAMES, "ask", true)).toContain("playing again");
  });

  it("admits when it could not pin the shot to anyone", () => {
    expect(proposalSubtitle(proposal({ winner: null }), NAMES, "ask", false)).toContain(
      "could not be pinned",
    );
  });
});

describe("what is said out loud", () => {
  it("asks the question and offers the score it would make", () => {
    const line = proposalCall(createSquashScore(), proposal(), NAMES, "suggest");
    expect(line).toBe("Point to Sam? That would be one, love.");
  });

  it("offers the game rather than the point when the game would end", () => {
    const line = proposalCall(scoreAt({ A: 10, B: 3 }, { A: 0, B: 0 }), proposal(), NAMES, "suggest");
    expect(line).toBe("Point to Sam? That would be game to Sam.");
  });

  it("offers the match when the match would end", () => {
    const line = proposalCall(scoreAt({ A: 10, B: 3 }, { A: 2, B: 0 }), proposal(), NAMES, "suggest");
    expect(line).toBe("Point to Sam? That would be the match to Sam.");
  });

  it("asks who won when it cannot tell", () => {
    const line = proposalCall(createSquashScore(), proposal({ winner: null }), NAMES, "suggest");
    expect(line).toBe("Rally over? I could not tell who hit last.");
  });

  it("names nobody out loud when the screen is naming nobody", () => {
    // The finding this guards: the screen deliberately shows two equal buttons
    // at "ask", while the voice still said "Point to Sam?" — putting a name in
    // the players' heads that the display is pointedly withholding.
    const line = proposalCall(createSquashScore(), proposal(), NAMES, "ask");
    expect(line).toBe("Rally over? Who won that one?");
    expect(line).not.toContain(NAMES.A);
    expect(line).not.toContain(NAMES.B);
  });

  it("says nothing at all once the match is decided", () => {
    const decided: SquashScore = { ...createSquashScore(), winner: "A" };
    expect(proposalCall(decided, proposal(), NAMES, "suggest")).toBeNull();
  });

  it("never speaks a marker's call — every spoken line is a question", () => {
    // announce.ts owns the declarative forms ("Hand out. Two, five.") and they
    // are reserved for a decision a human made. A player who half-hears this
    // must not be able to mistake it for the call.
    const states = [
      createSquashScore(),
      scoreAt({ A: 10, B: 3 }, { A: 0, B: 0 }),
      scoreAt({ A: 10, B: 3 }, { A: 2, B: 0 }),
      scoreAt({ A: 4, B: 4 }, { A: 1, B: 1 }),
    ];
    for (const state of states) {
      for (const winner of ["A", "B", null] as const) {
        const line = proposalCall(state, proposal({ winner }), NAMES, "suggest");
        expect(line).not.toBeNull();
        expect(line).toContain("?");
        expect(line).not.toContain("Hand out");
      }
    }
  });
});

describe("mapping the tracker's labels onto real people", () => {
  it("uses the bound names", () => {
    const why = humanizeWhy(proposal().why, { aIs: "A" }, NAMES);
    expect(why).toContain("Sam struck last");
    expect(why).not.toContain("Player A");
  });

  it("follows a swapped binding", () => {
    const why = humanizeWhy(proposal().why, { aIs: "B" }, NAMES);
    expect(why).toContain("Alex struck last");
  });

  it("does not collapse both tracks onto one player when the names are the defaults", () => {
    // The trap: two chained replaces map Player A -> "Player B" and then that
    // same text -> "Player A", so both tracks come out as the same human and
    // the sentence is quietly false. One pass, always.
    const why = humanizeWhy(
      "Player A struck last. Player B was moving.",
      { aIs: "B" },
      DEFAULT_PLAYER_NAMES,
    );
    expect(why).toBe("Player B struck last. Player A was moving.");
  });
});

describe("the numbers, where somebody has gone looking for them", () => {
  it("quotes the ceiling next to the confidence, every time", () => {
    expect(confidenceLine(proposal({ confidence: 0.41, ceiling: 0.727 }))).toBe(
      "Confidence 41%, which can never exceed 73% — that is how often the last player to hit " +
        "turned out to have won, on hand-labelled footage.",
    );
  });

  it("puts the measured accuracy and the missing ball tracking in the standing note", () => {
    expect(WATCH_ACCURACY_NOTE).toContain("8 rallies out of 11");
    expect(WATCH_ACCURACY_NOTE).toContain("ball is never tracked");
  });

  it("promises only what the app does, on the entry point", () => {
    expect(WATCH_PITCH).toContain("asks who won");
    expect(WATCH_PITCH).toContain("You decide");
  });
});
