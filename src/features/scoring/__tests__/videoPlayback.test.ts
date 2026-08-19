/**
 * Playback semantics: what the score is at a moment in the footage, and what
 * gets said when the playhead moves.
 *
 * The cases that matter are the ones a demo hits within a minute — scrubbing
 * back to re-watch a rally, dragging forward past several, and pausing — so
 * that is what is pinned here. The property underneath all of them: THE SCORE
 * IS A FUNCTION OF TIME. Seek anywhere, twice, in any order, and the same
 * moment always shows the same score.
 */
import { DEFAULT_PLAYER_NAMES } from "../announce";
import type { ShotEvent } from "@/features/analysis/types";

import {
  advance,
  CALL_DELAY_SEC,
  calledBy,
  callTime,
  eventsAfter,
  nextRallyStart,
  playbackNote,
  scoreAfter,
} from "../videoPlayback";
import { refereeVideo } from "../videoReferee";

/** Shots from "ABAB"-style rally strings: a shot a second, 6 s between rallies. */
function shotsFrom(rallies: string[]): ShotEvent[] {
  const shots: ShotEvent[] = [];
  let t = 0;
  for (const rally of rallies) {
    for (const player of rally) {
      shots.push({ tSec: t, player: player as "A" | "B", cell: "frontLeft" });
      t += 1;
    }
    t += 6;
  }
  return shots;
}

/** Three rallies won by A, A, B — ends at 1 s, 9 s, 17 s. */
const THREE = refereeVideo(shotsFrom(["BA", "BA", "AB"]));
const NAMES = DEFAULT_PLAYER_NAMES;

describe("when a rally is called", () => {
  it("lands a beat after the last strike, never on it", () => {
    const [first] = THREE.rallies;
    expect(first).toBeDefined();
    expect(callTime(first!)).toBeCloseTo(first!.endSec + CALL_DELAY_SEC, 5);
    // Comfortably inside the 4.5 s gap that separates two rallies, so a call
    // can never slide past the start of the rally after it.
    expect(CALL_DELAY_SEC).toBeLessThan(4.5);
  });

  it("counts what has been called at any moment, including before and after", () => {
    expect(calledBy(THREE.rallies, 0)).toBe(0);
    expect(calledBy(THREE.rallies, THREE.rallies[0]!.endSec)).toBe(0);
    expect(calledBy(THREE.rallies, callTime(THREE.rallies[0]!))).toBe(1);
    expect(calledBy(THREE.rallies, 10_000)).toBe(3);
  });
});

describe("the score is a function of time", () => {
  it("gives the same score for the same moment however it was reached", () => {
    const at = callTime(THREE.rallies[1]!);
    const forwards = scoreAfter(THREE.rallies, calledBy(THREE.rallies, at), THREE.firstServer);
    // Go to the end and come back.
    calledBy(THREE.rallies, 10_000);
    const backwards = scoreAfter(THREE.rallies, calledBy(THREE.rallies, at), THREE.firstServer);
    expect(backwards).toEqual(forwards);
    expect(forwards.points).toEqual({ A: 2, B: 0 });
  });

  it("rewinds the score when the playhead goes back", () => {
    const step = advance(THREE, 3, 0, NAMES);
    expect(step.called).toBe(0);
    expect(step.score.points).toEqual({ A: 0, B: 0 });
    // Rewinding is not a rally; it says nothing.
    expect(step.say).toBeNull();
    expect(step.jumped).toBe(true);
  });

  it("stops folding at match point, like the referee itself does", () => {
    const long = refereeVideo(shotsFrom(Array.from({ length: 40 }, () => "BA")));
    const score = scoreAfter(long.rallies, long.rallies.length, long.firstServer);
    expect(score.winner).toBe("A");
    expect(score.games).toEqual({ A: 3, B: 0 });
  });
});

describe("what gets said", () => {
  it("makes the marker's call when one rally lands", () => {
    const step = advance(THREE, 0, callTime(THREE.rallies[0]!), NAMES);
    expect(step.called).toBe(1);
    expect(step.say).toBe("One, love.");
    expect(step.jumped).toBe(false);
  });

  it("says nothing when nothing new has been crossed", () => {
    const step = advance(THREE, 1, callTime(THREE.rallies[0]!) + 0.1, NAMES);
    expect(step.called).toBe(1);
    expect(step.say).toBeNull();
  });

  it("says nothing when a seek skips several rallies at once", () => {
    // Dragging the scrubber forward past three rallies. The call for the last
    // of them describes a score the listener never heard build, and the other
    // two are stale before the sentence starts.
    const step = advance(THREE, 0, 10_000, NAMES);
    expect(step.called).toBe(3);
    expect(step.score.points).toEqual({ A: 2, B: 1 });
    expect(step.say).toBeNull();
    expect(step.jumped).toBe(true);
  });

  it("uses the same announcement builder as a tapped rally", () => {
    // Second rally: A wins again while serving, so it is a plain score call.
    const step = advance(THREE, 1, callTime(THREE.rallies[1]!), NAMES);
    expect(step.say).toBe("Two, love.");
    // Third: B takes it off A's serve, which is a hand out in the marker's
    // convention — the wording the tap-driven screen already produces.
    const third = advance(THREE, 2, callTime(THREE.rallies[2]!), NAMES);
    expect(third.say).toContain("Hand out");
  });

  it("says nothing for rallies played after the match was already decided", () => {
    const long = refereeVideo(shotsFrom(Array.from({ length: 40 }, () => "BA")));
    // Rally 34 — the first one after A took the match at 33.
    const decided = advance(long, 33, callTime(long.rallies[33]!), NAMES);
    expect(decided.called).toBe(34);
    expect(decided.say).toBeNull();
    // And the board does not move.
    expect(decided.score.games).toEqual({ A: 3, B: 0 });
  });
});

describe("the events it writes", () => {
  it("grows one rally at a time, stamped in video time", () => {
    expect(eventsAfter(THREE.rallies, 0)).toEqual([]);
    const two = eventsAfter(THREE.rallies, 2);
    expect(two).toHaveLength(2);
    expect(two[0]).toMatchObject({ kind: "rally", winner: "A", id: "vid-1" });
    expect(two[1]?.at).toBe(Math.round(THREE.rallies[1]!.endSec * 1000));
  });

  it("keeps ids stable as playback advances, so a re-fold cannot double-count", () => {
    const early = eventsAfter(THREE.rallies, 1);
    const later = eventsAfter(THREE.rallies, 3);
    expect(later.slice(0, 1)).toEqual(early);
  });
});

describe("skipping ahead", () => {
  it("lands just before the next rally starts, not after it has been called", () => {
    const target = nextRallyStart(THREE, 1);
    expect(target).toBeLessThan(THREE.rallies[1]!.startSec);
    expect(target).toBeGreaterThanOrEqual(0);
  });

  it("has nowhere to skip once every rally has been called", () => {
    expect(nextRallyStart(THREE, THREE.rallies.length)).toBeNull();
  });

  it("never seeks to a negative time on a rally that starts at zero", () => {
    const immediate = refereeVideo([
      { tSec: 0, player: "A", cell: "frontLeft" },
      { tSec: 0.5, player: "B", cell: "frontLeft" },
    ]);
    expect(nextRallyStart(immediate, 0)).toBe(0);
  });
});

describe("the note under the video", () => {
  it("says where playback has got to, and what is left", () => {
    expect(playbackNote(0, 18)).toContain("18 rallies to call");
    expect(playbackNote(7, 18)).toBe("Rally 7 of 18, called by the app as it plays.");
    expect(playbackNote(18, 18)).toContain("Correct any of them");
  });

  it("says so plainly when there was nothing to call", () => {
    expect(playbackNote(0, 0)).toContain("No rallies");
  });
});
