import {
  applyTennisEvent,
  applyTennisPoint,
  createTennisScore,
  formatTennisGame,
  reduceTennisEvents,
} from "../tennis";
import { Side, TennisScore } from "../types";
import { decision, rally } from "./fixtures";

/** Apply `n` consecutive points for `side`. */
function winPoints(score: TennisScore, side: Side, n: number): TennisScore {
  let s = score;
  for (let i = 0; i < n; i += 1) s = applyTennisPoint(s, side);
  return s;
}

/** Hand `side` a whole game (4 straight points from a fresh game). */
function winGames(score: TennisScore, side: Side, n: number): TennisScore {
  let s = score;
  for (let i = 0; i < n; i += 1) s = winPoints(s, side, 4);
  return s;
}

describe("createTennisScore", () => {
  it("starts at love-all, no games, no sets", () => {
    const s = createTennisScore();
    expect(s.points).toEqual({ A: "0", B: "0" });
    expect(s.games).toEqual({ A: 0, B: 0 });
    expect(s.sets).toEqual({ A: 0, B: 0 });
    expect(s.tiebreakPoints).toBeNull();
    expect(s.winner).toBeNull();
  });
});

describe("point ladder", () => {
  it("walks 0 → 15 → 30 → 40", () => {
    let s = createTennisScore();
    s = applyTennisPoint(s, "A");
    expect(s.points.A).toBe("15");
    s = applyTennisPoint(s, "A");
    expect(s.points.A).toBe("30");
    s = applyTennisPoint(s, "A");
    expect(s.points.A).toBe("40");
    expect(s.points.B).toBe("0");
  });

  it("wins the game to love and resets points", () => {
    const s = winPoints(createTennisScore(), "A", 4);
    expect(s.games).toEqual({ A: 1, B: 0 });
    expect(s.points).toEqual({ A: "0", B: "0" });
  });

  it("does not immutably leak: applying a point returns a new object", () => {
    const before = createTennisScore();
    const after = applyTennisPoint(before, "A");
    expect(before.points.A).toBe("0");
    expect(after).not.toBe(before);
  });
});

describe("deuce and advantage", () => {
  const deuce = winPoints(winPoints(createTennisScore(), "A", 3), "B", 3);

  it("reads deuce at 40-40", () => {
    expect(deuce.points).toEqual({ A: "40", B: "40" });
    expect(formatTennisGame(deuce)).toBe("Deuce");
  });

  it("gives advantage to the point winner", () => {
    const ad = applyTennisPoint(deuce, "B");
    expect(ad.points).toEqual({ A: "40", B: "AD" });
    expect(formatTennisGame(ad)).toBe("Ad B");
  });

  it("returns to deuce when the non-advantage side wins", () => {
    const back = applyTennisPoint(applyTennisPoint(deuce, "B"), "A");
    expect(back.points).toEqual({ A: "40", B: "40" });
  });

  it("wins the game from advantage", () => {
    const won = applyTennisPoint(applyTennisPoint(deuce, "B"), "B");
    expect(won.games).toEqual({ A: 0, B: 1 });
    expect(won.points).toEqual({ A: "0", B: "0" });
  });

  it("does not end the game 40-AD → winner on the 40 side", () => {
    const ad = applyTennisPoint(deuce, "A"); // Ad A
    const s = applyTennisPoint(ad, "B"); // back to deuce, NOT game B
    expect(s.games).toEqual({ A: 0, B: 0 });
  });
});

describe("games and sets", () => {
  it("takes a set 6-0 and archives it", () => {
    const s = winGames(createTennisScore(), "A", 6);
    expect(s.sets).toEqual({ A: 1, B: 0 });
    expect(s.setHistory).toEqual([{ A: 6, B: 0 }]);
    expect(s.games).toEqual({ A: 0, B: 0 });
  });

  it("requires a two-game margin: 6-5 is not a set, 7-5 is", () => {
    let s = winGames(createTennisScore(), "A", 5);
    s = winGames(s, "B", 5);
    s = winGames(s, "A", 1); // 6-5
    expect(s.sets).toEqual({ A: 0, B: 0 });
    s = winGames(s, "A", 1); // 7-5
    expect(s.sets).toEqual({ A: 1, B: 0 });
    expect(s.setHistory).toEqual([{ A: 7, B: 5 }]);
  });
});

describe("tiebreak", () => {
  /** 6-6 in games, tiebreak underway. */
  function atTiebreak(): TennisScore {
    let s = winGames(createTennisScore(), "A", 5);
    s = winGames(s, "B", 5);
    s = winGames(s, "A", 1); // 6-5
    s = winGames(s, "B", 1); // 6-6
    return s;
  }

  it("enters a tiebreak at 6-6", () => {
    const s = atTiebreak();
    expect(s.tiebreakPoints).toEqual({ A: 0, B: 0 });
    expect(formatTennisGame(s)).toBe("TB 0-0");
  });

  it("first to 7 with margin 2 takes the set 7-6", () => {
    const s = winPoints(atTiebreak(), "B", 7);
    expect(s.sets).toEqual({ A: 0, B: 1 });
    expect(s.setHistory).toEqual([{ A: 6, B: 7 }]);
    expect(s.tiebreakPoints).toBeNull();
  });

  it("7-6 in the tiebreak does not end it; win-by-2 applies", () => {
    let s = atTiebreak();
    s = winPoints(s, "A", 6);
    s = winPoints(s, "B", 6); // 6-6 in the breaker
    s = applyTennisPoint(s, "A"); // 7-6
    expect(s.sets).toEqual({ A: 0, B: 0 });
    expect(s.tiebreakPoints).toEqual({ A: 7, B: 6 });
    s = applyTennisPoint(s, "A"); // 8-6
    expect(s.sets).toEqual({ A: 1, B: 0 });
  });
});

describe("match completion", () => {
  it("best of 3: two sets wins the match", () => {
    const s = winGames(createTennisScore(), "A", 12);
    expect(s.sets).toEqual({ A: 2, B: 0 });
    expect(s.winner).toBe("A");
    expect(s.setHistory).toEqual([
      { A: 6, B: 0 },
      { A: 6, B: 0 },
    ]);
  });

  it("ignores points after match point (trailing AI events stay harmless)", () => {
    const done = winGames(createTennisScore(), "A", 12);
    const after = applyTennisPoint(done, "B");
    expect(after).toEqual(done);
  });

  it("best of 5 keeps going after two sets", () => {
    const s = winGames(createTennisScore({ setsToWin: 3, gamesPerSet: 6, tiebreakTo: 7 }), "A", 12);
    expect(s.winner).toBeNull();
    expect(winGames(s, "A", 6).winner).toBe("A");
  });
});

describe("reduceTennisEvents", () => {
  it("folds an ordered event stream into the same state as manual application", () => {
    const events = Array.from({ length: 8 }, (_, i) => rally(i % 2 ? "B" : "A"));
    const folded = reduceTennisEvents(events);
    const manual = events.reduce((s, e) => applyTennisPoint(s, e.winner), createTennisScore());
    expect(folded).toEqual(manual);
    expect(folded.games).toEqual({ A: 0, B: 0 });
    expect(folded.points).toEqual({ A: "40", B: "40" });
  });

  it("treats let-decision events (a squash concept) as replayed points", () => {
    const mid = applyTennisPoint(createTennisScore(), "A");
    expect(applyTennisEvent(mid, decision("B", "stroke"))).toBe(mid);
    expect(applyTennisEvent(mid, decision("B", "no-let"))).toBe(mid);
  });
});
