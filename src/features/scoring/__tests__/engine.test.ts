import { getScoreEngine, hasScoreEngine } from "../engine";
import { needsReview, REVIEW_CONFIDENCE_THRESHOLD, ScoreEvent, Sport } from "../types";
import { decision, rally } from "./fixtures";

const REGISTERED: Sport[] = ["squash", "tennis"];
const PENDING: Sport[] = ["pickleball", "badminton"];

/** A mixed stream every engine must be able to fold without throwing. */
function mixedStream(): ScoreEvent[] {
  return [
    rally("A"),
    rally("B"),
    decision("A", "let"),
    rally("A", { source: "ai", confidence: 0.6 }),
    decision("B", "stroke"),
    rally("B"),
  ];
}

describe("registry", () => {
  it.each(REGISTERED)("resolves the %s engine to its own sport", (sport) => {
    expect(hasScoreEngine(sport)).toBe(true);
    expect(getScoreEngine(sport).sport).toBe(sport);
  });

  it.each(PENDING)("has no %s engine yet and says so loudly", (sport) => {
    expect(hasScoreEngine(sport)).toBe(false);
    expect(() => getScoreEngine(sport)).toThrow(`"${sport}"`);
  });
});

describe("engine laws (shared by every sport)", () => {
  it.each(REGISTERED)("%s: initial() is tagged with the sport and undecided", (sport) => {
    const s = getScoreEngine(sport).initial();
    expect(s.sport).toBe(sport);
    expect(s.winner).toBeNull();
  });

  it.each(REGISTERED)("%s: reduce === fold of apply from initial", (sport) => {
    const engine = getScoreEngine(sport);
    const events = mixedStream();
    const folded = engine.reduce(events);
    const manual = events.reduce((s, e) => engine.apply(s, e), engine.initial());
    expect(folded).toEqual(manual);
  });

  it.each(REGISTERED)("%s: apply never mutates its input", (sport) => {
    const engine = getScoreEngine(sport);
    const before = engine.initial();
    const snapshot = JSON.parse(JSON.stringify(before));
    engine.apply(before, rally("A"));
    expect(before).toEqual(snapshot);
  });

  it.each(REGISTERED)("%s: summary is a non-empty scoreboard line", (sport) => {
    const engine = getScoreEngine(sport);
    expect(engine.summary(engine.reduce(mixedStream())).length).toBeGreaterThan(0);
  });
});

describe("needsReview", () => {
  it("queues low-confidence AI events", () => {
    expect(needsReview(rally("A", { source: "ai", confidence: 0.6 }))).toBe(true);
  });

  it("passes confident AI events at the threshold", () => {
    expect(needsReview(rally("A", { source: "ai", confidence: REVIEW_CONFIDENCE_THRESHOLD }))).toBe(
      false,
    );
  });

  it("never queues human events, however unsure they were", () => {
    expect(needsReview(decision("B", "stroke", { source: "human", confidence: 0.1 }))).toBe(false);
  });
});
