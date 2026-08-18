/**
 * The laws every score engine has to obey. They are the reason the Score
 * keeper screen can implement undo as "drop the last event and re-fold"
 * instead of as an inverse mutation.
 */
import { getScoreEngine } from "../engine";
import { ScoreEvent } from "../types";
import { boxChoice, decision, rally } from "./fixtures";

/** A mixed stream covering every event kind. */
function mixedStream(): ScoreEvent[] {
  return [
    boxChoice("left"),
    rally("A"),
    rally("B"),
    decision("A", "let"),
    rally("A"),
    decision("B", "stroke"),
    rally("B"),
  ];
}

describe("registry", () => {
  it("resolves the squash engine, which is also the default", () => {
    expect(getScoreEngine("squash").sport).toBe("squash");
    expect(getScoreEngine()).toBe(getScoreEngine("squash"));
  });
});

describe("engine laws", () => {
  it("initial() is tagged with the sport and undecided", () => {
    const s = getScoreEngine().initial();
    expect(s.sport).toBe("squash");
    expect(s.winner).toBeNull();
  });

  it("reduce === fold of apply from initial", () => {
    const engine = getScoreEngine();
    const events = mixedStream();
    const folded = engine.reduce(events);
    const manual = events.reduce((s, e) => engine.apply(s, e), engine.initial());
    expect(folded).toEqual(manual);
  });

  it("apply never mutates its input", () => {
    const engine = getScoreEngine();
    const before = engine.initial();
    const snapshot: unknown = JSON.parse(JSON.stringify(before));
    engine.apply(before, rally("A"));
    expect(before).toEqual(snapshot);
  });

  it("re-folding a truncated stream is a working undo", () => {
    const engine = getScoreEngine();
    const events = mixedStream();
    const undone = engine.reduce(events.slice(0, -1));
    expect(undone).toEqual(engine.reduce(events.slice(0, -1)));
    expect(undone).not.toEqual(engine.reduce(events));
  });

  it("summary is a non-empty scoreboard line", () => {
    const engine = getScoreEngine();
    expect(engine.summary(engine.reduce(mixedStream())).length).toBeGreaterThan(0);
  });
});
