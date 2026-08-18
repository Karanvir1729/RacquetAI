import {
  applySquashEvent,
  applySquashLetDecision,
  applySquashRally,
  chooseSquashServeBox,
  createSquashScore,
  formatSquashScore,
  reduceSquashEvents,
} from "../squash";
import { Side, SquashScore } from "../types";
import { boxChoice, decision, rally } from "./fixtures";

/** Apply `n` consecutive rally wins for `side`. */
function winRallies(score: SquashScore, side: Side, n: number): SquashScore {
  let s = score;
  for (let i = 0; i < n; i += 1) s = applySquashRally(s, side);
  return s;
}

/** Hand `side` a whole game (11 straight rallies from a fresh game). */
function winGames(score: SquashScore, side: Side, n: number): SquashScore {
  let s = score;
  for (let i = 0; i < n; i += 1) s = winRallies(s, side, 11);
  return s;
}

describe("createSquashScore", () => {
  it("starts 0-0, no games, first server ready to pick a box", () => {
    const s = createSquashScore();
    expect(s.points).toEqual({ A: 0, B: 0 });
    expect(s.games).toEqual({ A: 0, B: 0 });
    expect(s.gameHistory).toEqual([]);
    expect(s.server).toBe("A");
    expect(s.serverMayChooseBox).toBe(true);
    expect(s.winner).toBeNull();
  });

  it("honours the racquet-spin winner as first server", () => {
    expect(createSquashScore(undefined, "B").server).toBe("B");
  });
});

describe("point-a-rally", () => {
  it("scores for the rally winner even when they were receiving", () => {
    const s = applySquashRally(createSquashScore(), "B"); // B receives, wins rally
    expect(s.points).toEqual({ A: 0, B: 1 });
  });

  it("never mutates: applying a rally returns a new object", () => {
    const before = createSquashScore();
    const after = applySquashRally(before, "A");
    expect(before.points.A).toBe(0);
    expect(after).not.toBe(before);
  });
});

describe("serve hand and box", () => {
  it("retained serve alternates the box and closes the box choice", () => {
    let s = chooseSquashServeBox(createSquashScore(), "right");
    s = applySquashRally(s, "A"); // server wins
    expect(s.server).toBe("A");
    expect(s.serveBox).toBe("left");
    expect(s.serverMayChooseBox).toBe(false);
    s = applySquashRally(s, "A");
    expect(s.serveBox).toBe("right");
  });

  it("handout: rally winner takes the serve and may choose either box", () => {
    const s = applySquashRally(createSquashScore(), "B");
    expect(s.server).toBe("B");
    expect(s.serverMayChooseBox).toBe(true);
    expect(chooseSquashServeBox(s, "left").serveBox).toBe("left");
  });

  it("box choice is a no-op while the server is retaining serve", () => {
    const retaining = applySquashRally(createSquashScore(), "A");
    expect(retaining.serverMayChooseBox).toBe(false);
    expect(chooseSquashServeBox(retaining, "right")).toBe(retaining);
  });
});

describe("games (PAR-11, win by 2)", () => {
  it("takes a game at 11 and archives the points", () => {
    const s = winRallies(createSquashScore(), "A", 11);
    expect(s.games).toEqual({ A: 1, B: 0 });
    expect(s.gameHistory).toEqual([{ A: 11, B: 0 }]);
    expect(s.points).toEqual({ A: 0, B: 0 });
  });

  it("10-10 plays on: 11-10 is not a game, 12-10 is", () => {
    let s = winRallies(createSquashScore(), "A", 10);
    s = winRallies(s, "B", 10); // 10-10
    s = applySquashRally(s, "A"); // 11-10
    expect(s.games).toEqual({ A: 0, B: 0 });
    expect(s.points).toEqual({ A: 11, B: 10 });
    s = applySquashRally(s, "A"); // 12-10
    expect(s.games).toEqual({ A: 1, B: 0 });
    expect(s.gameHistory).toEqual([{ A: 12, B: 10 }]);
  });

  it("game winner serves first in the next game and picks a box", () => {
    let s = applySquashRally(createSquashScore(), "B"); // B takes the serve...
    s = winRallies(s, "A", 11); // ...but A takes the game
    expect(s.server).toBe("A");
    expect(s.serverMayChooseBox).toBe(true);
  });
});

describe("match completion (best of 5)", () => {
  it("three games win the match", () => {
    const s = winGames(createSquashScore(), "A", 3);
    expect(s.winner).toBe("A");
    expect(s.games).toEqual({ A: 3, B: 0 });
    expect(s.gameHistory).toHaveLength(3);
  });

  it("ignores rallies after match end (trailing AI events stay harmless)", () => {
    const done = winGames(createSquashScore(), "A", 3);
    expect(applySquashRally(done, "B")).toEqual(done);
  });

  it("2-2 in games forces a fifth", () => {
    let s = winGames(createSquashScore(), "A", 2);
    s = winGames(s, "B", 2);
    expect(s.winner).toBeNull();
    expect(winGames(s, "B", 1).winner).toBe("B");
  });
});

describe("let / stroke / no-let decisions", () => {
  const base = winRallies(createSquashScore(), "A", 3); // 3-0, A serving

  it("a let replays the rally: score, server, and box unchanged", () => {
    expect(applySquashLetDecision(base, "B", "let")).toBe(base);
  });

  it("a stroke awards the rally to the appealer", () => {
    const s = applySquashLetDecision(base, "B", "stroke");
    expect(s.points).toEqual({ A: 3, B: 1 });
    expect(s.server).toBe("B"); // winning the rally wins the serve too
  });

  it("no-let awards the rally to the appealer's opponent", () => {
    const s = applySquashLetDecision(base, "B", "no-let");
    expect(s.points).toEqual({ A: 4, B: 0 });
    expect(s.server).toBe("A");
  });

  it("decisions after match end are no-ops", () => {
    const done = winGames(createSquashScore(), "A", 3);
    expect(applySquashLetDecision(done, "B", "stroke")).toEqual(done);
  });
});

describe("reduceSquashEvents", () => {
  it("folds a mixed rally + decision stream like manual application", () => {
    const events = [
      rally("A"),
      rally("A"),
      decision("B", "let"),
      decision("B", "stroke"),
      rally("B"),
      decision("A", "no-let"),
    ];
    const folded = reduceSquashEvents(events);
    const manual = events.reduce((s, e) => applySquashEvent(s, e), createSquashScore());
    expect(folded).toEqual(manual);
    expect(folded.points).toEqual({ A: 2, B: 3 }); // stroke→B, rally→B, no-let→B
    expect(folded.server).toBe("B");
  });

  it("honours the first server through a folded stream", () => {
    const folded = reduceSquashEvents([rally("B")], undefined, "B");
    expect(folded.server).toBe("B");
    expect(folded.serveBox).toBe("left"); // B retained serve, so the box flipped
  });
});

describe("serve-box events", () => {
  it("a box choice survives a re-fold, so undo cannot silently revert it", () => {
    const events = [boxChoice("left"), rally("A")];
    const folded = reduceSquashEvents(events);
    // Chose left, then held serve → the box alternates to right.
    expect(folded.serveBox).toBe("right");
    // Undo the rally by re-folding the shortened list: the choice is still there.
    expect(reduceSquashEvents(events.slice(0, 1)).serveBox).toBe("left");
  });

  it("is a no-op when no choice is open", () => {
    const retaining = reduceSquashEvents([rally("A")]); // server held serve
    expect(applySquashEvent(retaining, boxChoice("right"))).toBe(retaining);
  });
});

describe("formatSquashScore", () => {
  it("reads points, games, and the serve hand", () => {
    const s = winRallies(createSquashScore(), "A", 2);
    expect(formatSquashScore(s)).toBe("2-0 · games 0-0 · A serves (right)");
  });

  it("reads the match result once decided", () => {
    const s = winGames(createSquashScore(), "B", 3);
    expect(formatSquashScore(s)).toBe("B wins 3-0");
  });
});
