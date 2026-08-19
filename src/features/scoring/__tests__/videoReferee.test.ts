/**
 * Refereeing a video: the rally split, the fold, and the honesty around both.
 *
 * The arithmetic here is the whole feature — nobody is courtside to catch a
 * wrong scoreline — so the interesting cases are the ones where the shot
 * stream is NOT a tidy match: strays between rallies, footage that runs on
 * past match point, an unsorted list, a swapped player binding.
 */
import type { ShotEvent } from "@/features/analysis/types";

import {
  DEFAULT_PLAYER_BINDING,
  flipPlayerBinding,
  MIN_RALLY_SHOTS,
  RALLY_GAP_SEC,
  rallyConfidence,
  refereeVideo,
  scorelineNote,
  sideForPlayer,
  splitRallies,
  toScoreEvents,
} from "../videoReferee";

/** A shot list from a compact description: one string per rally, "ABAB". */
function shotsFrom(rallies: string[], gap = RALLY_GAP_SEC + 1): ShotEvent[] {
  const shots: ShotEvent[] = [];
  let t = 0;
  for (const rally of rallies) {
    for (const player of rally) {
      shots.push({ tSec: t, player: player as "A" | "B", cell: "frontLeft" });
      t += 1; // a shot a second — well inside the gap
    }
    t += gap;
  }
  return shots;
}

describe("splitRallies", () => {
  it("splits on a silence longer than the gap and not on one inside it", () => {
    const shots = shotsFrom(["ABAB", "BABA", "AB"]);
    expect(splitRallies(shots).map((r) => r.length)).toEqual([4, 4, 2]);
  });

  it("keeps a rally together when the gap is exactly the threshold", () => {
    // Boundary: the rule is "> gap", so a gap of exactly RALLY_GAP_SEC is
    // still one rally. Squash rallies do pause; the threshold has to be a
    // strict inequality or a legitimate long pause invents a point.
    const shots: ShotEvent[] = [
      { tSec: 0, player: "A", cell: "frontLeft" },
      { tSec: RALLY_GAP_SEC, player: "B", cell: "frontLeft" },
    ];
    expect(splitRallies(shots)).toHaveLength(1);
  });

  it("sorts an out-of-order stream before splitting", () => {
    const shots: ShotEvent[] = [
      { tSec: 2, player: "B", cell: "frontLeft" },
      { tSec: 0, player: "A", cell: "frontLeft" },
      { tSec: 1, player: "A", cell: "frontLeft" },
    ];
    const [rally] = splitRallies(shots);
    expect(rally?.map((s) => s.tSec)).toEqual([0, 1, 2]);
  });

  it("has nothing to split when there are no shots", () => {
    expect(splitRallies([])).toEqual([]);
  });
});

describe("refereeVideo", () => {
  it("awards each rally to the last striker", () => {
    // Three rallies, last striker A, B, A.
    const result = refereeVideo(shotsFrom(["BA", "AB", "BA"]));
    expect(result.rallies.map((r) => r.winner)).toEqual(["A", "B", "A"]);
    expect(result.score.points).toEqual({ A: 2, B: 1 });
  });

  it("discards a break too short to have been a rally, and says how many", () => {
    // A single onset alone between two silences: a door, a bounce, a pickup.
    const result = refereeVideo(shotsFrom(["ABAB", "A", "BABA"]));
    expect(result.rallies).toHaveLength(2);
    expect(result.discarded).toBe(1);
    expect(MIN_RALLY_SHOTS).toBe(2);
  });

  it("stops scoring at match point and counts what came after", () => {
    // 33 rallies all won by A: three games at 11, then footage that runs on.
    const rallies = Array.from({ length: 40 }, () => "BA");
    const result = refereeVideo(shotsFrom(rallies));
    expect(result.rallies).toHaveLength(40);
    expect(result.score.winner).toBe("A");
    expect(result.score.games).toEqual({ A: 3, B: 0 });
    expect(result.ignoredAfterMatch).toBe(40 - 33);
  });

  it("respects the player binding, and flipping it mirrors the scoreline", () => {
    const shots = shotsFrom(["BA", "BA", "AB"]);
    const straight = refereeVideo(shots, { binding: DEFAULT_PLAYER_BINDING });
    const flipped = refereeVideo(shots, { binding: flipPlayerBinding(DEFAULT_PLAYER_BINDING) });
    expect(straight.score.points).toEqual({ A: 2, B: 1 });
    expect(flipped.score.points).toEqual({ A: 1, B: 2 });
  });

  it("honours the first server, which no video can reveal", () => {
    const shots = shotsFrom(["AB"]);
    // B wins the only rally. Serving first is a setup fact, so with A serving
    // first that rally is a hand-out, and with B serving it is not.
    expect(refereeVideo(shots, { firstServer: "A" }).score.server).toBe("B");
    expect(refereeVideo(shots, { firstServer: "B" }).score.server).toBe("B");
  });

  it("takes a longer gap as an option — the rule is per venue", () => {
    const shots = shotsFrom(["AB", "AB"], 6);
    expect(refereeVideo(shots).rallies).toHaveLength(2);
    expect(refereeVideo(shots, { gapSec: 8 }).rallies).toHaveLength(1);
  });

  it("returns an empty, decided-by-nobody result for a video with no shots", () => {
    const result = refereeVideo([]);
    expect(result.rallies).toEqual([]);
    expect(result.score.points).toEqual({ A: 0, B: 0 });
    expect(result.score.winner).toBeNull();
  });
});

describe("toScoreEvents", () => {
  it("emits one rally event per SCORED rally, stamped at video time", () => {
    const result = refereeVideo(shotsFrom(["BA", "AB"]));
    const events = toScoreEvents(result);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(["rally", "rally"]);
    // Video time, not wall clock: these events describe a match that happened
    // whenever the footage was shot.
    expect(events[0]?.at).toBe(Math.round(result.rallies[0]!.endSec * 1000));
    expect(events.every((e) => e.at < Date.now())).toBe(true);
  });

  it("drops the rallies that were played after the match was decided", () => {
    const result = refereeVideo(shotsFrom(Array.from({ length: 40 }, () => "BA")));
    expect(toScoreEvents(result)).toHaveLength(33);
  });

  it("gives every event a distinct id, so the fold cannot collapse them", () => {
    const result = refereeVideo(shotsFrom(["BA", "AB", "BA"]));
    const ids = toScoreEvents(result).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the honesty", () => {
  it("quotes the measured ceiling per rally, never higher", () => {
    expect(rallyConfidence).toBeCloseTo(0.727, 3);
  });

  it("says the errors add up, and never calls the scoreline a result", () => {
    const note = scorelineNote(24);
    expect(note).toContain("24 rallies");
    expect(note).toContain("73%");
    expect(note).toMatch(/add up/);
    expect(note).toMatch(/draft to correct, not a result/);
  });

  it("counts one rally in the singular", () => {
    expect(scorelineNote(1)).toContain("1 rally found");
  });
});

describe("sideForPlayer", () => {
  it("maps the analyser's labels onto the scoreboard, both ways", () => {
    expect(sideForPlayer("A", { aIs: "A" })).toBe("A");
    expect(sideForPlayer("B", { aIs: "A" })).toBe("B");
    expect(sideForPlayer("A", { aIs: "B" })).toBe("B");
    expect(sideForPlayer("B", { aIs: "B" })).toBe("A");
  });
});
