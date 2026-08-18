/**
 * The wording of the spoken calls. This is the feature's contract with the two
 * people on court: an announcement that is late, ambiguous, or in the wrong
 * order is worse than silence, because they will act on it.
 */
import {
  buildAnnouncement,
  correctionCall,
  DEFAULT_PLAYER_NAMES,
  gameBallSide,
  matchStartCall,
  PlayerNames,
  scoreCall,
  scoreWord,
} from "../announce";
import { applySquashRally, createSquashScore } from "../squash";
import { LetRuling, ScoreEvent, Side, SquashScore } from "../types";

const NAMES: PlayerNames = { A: "Priya", B: "Sam" };

/** Build a mid-match state by handing out rallies in order. */
function state(sequence: Side[], firstServer: Side = "A"): SquashScore {
  return sequence.reduce(applySquashRally, createSquashScore(undefined, firstServer));
}

/** `n` straight rallies for `side` from the given state. */
function run(score: SquashScore, side: Side, n: number): SquashScore {
  let s = score;
  for (let i = 0; i < n; i += 1) s = applySquashRally(s, side);
  return s;
}

const rallyEvent = (winner: Side): ScoreEvent => ({ id: "x", at: 0, kind: "rally", winner });
const appealEvent = (appealer: Side, ruling: LetRuling): ScoreEvent => ({
  id: "x",
  at: 0,
  kind: "let-decision",
  appealer,
  ruling,
});

/** Apply a rally and announce it, the pairing the screen always uses. */
function announceRally(before: SquashScore, winner: Side, names = DEFAULT_PLAYER_NAMES) {
  return buildAnnouncement(before, rallyEvent(winner), applySquashRally(before, winner), names);
}

describe("scoreWord", () => {
  it("calls zero love, the way a marker does", () => {
    expect(scoreWord(0)).toBe("love");
  });

  it("spells numbers out so a voice cannot read 10-8 as a decimal", () => {
    expect(scoreWord(1)).toBe("one");
    expect(scoreWord(10)).toBe("ten");
    expect(scoreWord(11)).toBe("eleven");
  });

  it("falls back to digits past the table rather than inventing a word", () => {
    expect(scoreWord(21)).toBe("21");
    expect(scoreWord(-1)).toBe("-1");
    expect(scoreWord(1.5)).toBe("1.5");
  });
});

describe("scoreCall", () => {
  it("calls the server's score first, not side A's", () => {
    // B took the serve and leads 1-0 in points.
    const s = state(["B"]);
    expect(s.server).toBe("B");
    expect(scoreCall(s)).toBe("one, love");
  });

  it("says 'all' on level scores", () => {
    expect(scoreCall(createSquashScore())).toBe("love all");
    expect(scoreCall(state(["A", "B", "A", "B", "A", "B", "A", "B"]))).toBe("four all");
  });
});

describe("gameBallSide", () => {
  it("is nobody at 10-10, because 11-10 does not win the game", () => {
    const s = run(run(createSquashScore(), "A", 10), "B", 10);
    expect(s.points).toEqual({ A: 10, B: 10 });
    expect(gameBallSide(s)).toBeNull();
  });

  it("is the side one rally from taking the game", () => {
    expect(gameBallSide(run(createSquashScore(), "A", 10))).toBe("A");
  });

  it("is nobody once the match is decided", () => {
    let s = createSquashScore();
    for (let i = 0; i < 3; i += 1) s = run(s, "A", 11);
    expect(s.winner).toBe("A");
    expect(gameBallSide(s)).toBeNull();
  });
});

describe("buildAnnouncement — rallies", () => {
  it("calls the score, server first", () => {
    expect(announceRally(createSquashScore(), "A")).toBe("One, love.");
  });

  it("announces the change of hand before the new server's score", () => {
    expect(announceRally(createSquashScore(), "B")).toBe("Hand out. One, love.");
  });

  it("says 'all' on level scores", () => {
    expect(announceRally(state(["A", "B", "A"]), "B")).toBe("Hand out. Two all.");
  });

  it("adds game ball unqualified when it is the server's", () => {
    // A serving at 9-3; the tenth point puts A one rally from the game.
    const before = run(run(createSquashScore(), "B", 3), "A", 9);
    expect(before.server).toBe("A");
    expect(announceRally(before, "A")).toBe("Ten, three. Game ball.");
  });

  it("names the player when game ball belongs to the RECEIVER", () => {
    // B sits on 10 but A is serving, so an unqualified "game ball" would be
    // heard as the server's.
    const before = run(run(createSquashScore(), "A", 2), "B", 10);
    expect(before.server).toBe("B");
    const handedBack = applySquashRally(before, "A"); // A wins the serve back
    expect(announceRally(handedBack, "A", NAMES)).toBe("Four, ten. Game ball, Sam.");
  });

  it("upgrades game ball to match ball on the deciding game", () => {
    let s = createSquashScore();
    for (let i = 0; i < 2; i += 1) s = run(s, "A", 11); // A leads two games
    s = run(run(s, "B", 3), "A", 9);
    expect(announceRally(s, "A")).toBe("Ten, three. Match ball.");
  });
});

describe("buildAnnouncement — games and match", () => {
  it("calls the game and the games tally", () => {
    const before = run(createSquashScore(), "A", 10);
    expect(announceRally(before, "A", NAMES)).toBe("Game to Priya. One game to love.");
  });

  it("says 'games all' when the match is level", () => {
    let s = run(createSquashScore(), "A", 11); // A takes the first
    s = run(s, "B", 10);
    expect(announceRally(s, "B", NAMES)).toBe("Game to Sam. One game all.");
  });

  it("calls the match, not just the game, on the final point", () => {
    let s = createSquashScore();
    for (let i = 0; i < 2; i += 1) s = run(s, "A", 11);
    s = run(run(s, "A", 10), "B", 4);
    expect(announceRally(s, "A", NAMES)).toBe("Match to Priya. Three games to love.");
  });

  it("stays silent on taps after the match is already decided", () => {
    let s = createSquashScore();
    for (let i = 0; i < 3; i += 1) s = run(s, "A", 11);
    expect(announceRally(s, "B")).toBeNull();
  });
});

describe("buildAnnouncement — appeals", () => {
  const base = run(createSquashScore(), "A", 3); // 3-0, A serving

  it("announces a let and repeats the unchanged score", () => {
    const event = appealEvent("B", "let");
    expect(buildAnnouncement(base, event, base, NAMES)).toBe("Yes let. Three, love.");
  });

  it("names who the stroke went to, then the hand out and the score", () => {
    const event = appealEvent("B", "stroke");
    const after = applySquashRally(base, "B");
    expect(buildAnnouncement(base, event, after, NAMES)).toBe(
      "Stroke to Sam. Hand out. One, three.",
    );
  });

  it("calls no let, then the score", () => {
    const event = appealEvent("B", "no-let");
    const after = applySquashRally(base, "A");
    expect(buildAnnouncement(base, event, after, NAMES)).toBe("No let. Four, love.");
  });
});

describe("buildAnnouncement — nothing to say", () => {
  it("says nothing about a service box choice", () => {
    const before = createSquashScore();
    const event: ScoreEvent = { id: "x", at: 0, kind: "serve-box", box: "left" };
    expect(buildAnnouncement(before, event, { ...before, serveBox: "left" }, NAMES)).toBeNull();
  });
});

describe("match start and corrections", () => {
  it("opens with who serves, from love all", () => {
    expect(matchStartCall(NAMES, "B")).toBe("Sam to serve. Love all.");
  });

  it("flags an undo as a correction so it is not heard as a new rally", () => {
    expect(correctionCall(state(["A", "A", "B"]), NAMES)).toBe("Correction. One, two.");
  });

  it("restates the result when an undo lands back inside a finished match", () => {
    let s = createSquashScore();
    for (let i = 0; i < 3; i += 1) s = run(s, "A", 11);
    expect(correctionCall(s, NAMES)).toBe("Correction. Match to Priya.");
  });
});
