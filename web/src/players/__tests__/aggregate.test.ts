/**
 * Many clips → one profile, checked against the REAL sample analysis rather
 * than invented numbers. The property that matters most: a profile of ONE
 * clip must say exactly what that clip's read-out says — same predictability
 * (the pipeline's own entropy formula, not an average of scores), same
 * T-time, same placement, same court plan. If that ever drifts, the profile
 * page and the read-out disagree about the same match, which is the one thing
 * the product promises not to do.
 *
 * The two-clip cases work the weights by hand (time for T-time, rallies for
 * rally length) so the expectations are independent of the code under test.
 * The scouting-note rules are driven one at a time from a "quiet" profile
 * that says nothing, so each assertion isolates one threshold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COURT_CELLS, parseAnalysisValue, type MatchAnalysis } from "../../analysis/types";
import {
  MIN_CLASSIFIED_FOR_NOTES,
  MIN_SHOTS_FOR_NOTES,
  buildProfileStats,
  calendarWeeks,
  predictabilityFromTransitions,
  scoutingNotes,
  sortChronologically,
  type ProfileStats,
} from "../aggregate";
import { summarizeClip, type ClipSummary, type PlayerClip, type ShotTypeCounts, type Transitions } from "../shape";

const SAMPLE_PATH = join(__dirname, "..", "..", "..", "public", "sample", "analysis.json");

const REAL: MatchAnalysis = (() => {
  const parsed = parseAnalysisValue(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
  if (parsed === null) throw new Error("the bundled sample analysis no longer parses");
  return parsed;
})();

function summaryOf(side: "A" | "B"): ClipSummary {
  const summary = summarizeClip(REAL, side);
  if (summary === null) throw new Error(`the sample has no side ${side}`);
  return summary;
}

/** A tagged clip around a summary; the defaults are one plausible row. */
function clipOf(summary: ClipSummary, overrides: Partial<PlayerClip> = {}): PlayerClip {
  return {
    id: "clip-a",
    playerId: "player-1",
    side: "A",
    title: "match.mp4",
    jobId: null,
    historyId: null,
    playedAt: "2026-08-13",
    durationSec: summary.durationSec,
    shots: summary.me.shots,
    summary,
    createdAt: "2026-08-13T12:00:00.000Z",
    ...overrides,
  };
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function mergeTransitions(...maps: Transitions[]): Transitions {
  const merged: Transitions = {};
  for (const map of maps) {
    for (const [key, count] of Object.entries(map)) merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

function frontShare(placement: Record<string, number>): number {
  return ((placement.frontLeft ?? 0) + (placement.frontRight ?? 0)) / sumValues(placement);
}

// The sample's side A, and side B made into a second, shorter, earlier clip
// with its own rally count so the weights have something to weigh.
const A = summaryOf("A");
const B: ClipSummary = {
  ...summaryOf("B"),
  durationSec: 300,
  rallies: { count: 3, avgShotsPerRally: 20, longestRally: 30 },
};
const CLIP_A = clipOf(A, { id: "clip-a", playedAt: "2026-08-13" });
const CLIP_B = clipOf(B, {
  id: "clip-b",
  side: "B",
  title: "earlier.mp4",
  playedAt: "2026-07-02",
  createdAt: "2026-07-02T12:00:00.000Z",
});

describe("buildProfileStats — one clip says what its read-out says", () => {
  const stats = buildProfileStats([CLIP_A]);

  it("reproduces the pipeline's predictability from the stored transitions", () => {
    // The pipeline rounds to 3 dp and so does the pooled formula; ±0.002
    // leaves room for the rounding on either side and nothing else.
    expect(stats.predictability).not.toBeNull();
    expect(Math.abs((stats.predictability ?? 0) - A.me.predictability.score)).toBeLessThanOrEqual(0.002);
    expect(stats.transitionsTotal).toBe(sumValues(A.me.transitions));
  });

  it("keeps the T-time, placement and shot mix exactly", () => {
    expect(stats.recordings).toBe(1);
    expect(stats.totalSec).toBe(A.durationSec);
    expect(stats.totalShots).toBe(A.me.shots);
    expect(stats.totalRallies).toBe(A.rallies.count);
    expect(stats.longestRally).toBe(A.rallies.longestRally);
    // Weighted means of one value: the value, to floating-point precision.
    expect(stats.avgRallyShots).toBeCloseTo(A.rallies.avgShotsPerRally, 9);
    expect(stats.tTimePct).toBeCloseTo(A.me.tTimePct, 9);
    expect(stats.qualityPct).toBeCloseTo(A.quality.bothPlayersDetectedPct, 9);
    expect(stats.placement).toEqual(A.me.placement);
    expect(stats.placementTotal).toBe(sumValues(A.me.placement));
    expect(stats.frontShare).toBeCloseTo(frontShare(A.me.placement), 12);
    expect(stats.leftShare).toBeCloseTo(
      (A.me.placement.frontLeft + A.me.placement.backLeft) / sumValues(A.me.placement),
      12,
    );
    expect(stats.shotTypes).toEqual(A.me.shotTypes);
    expect(stats.classifiedShots).toBe(A.me.classifiedShots);
    expect(stats.firstPlayedAt).toBe("2026-08-13");
    expect(stats.lastPlayedAt).toBe("2026-08-13");
  });

  it("keeps the court plan, on the same peak-is-one convention", () => {
    const coverage = A.me.coverage;
    if (coverage === null) throw new Error("the sample carries no coverage");
    // Guard the premise: the sample's map already peaks at 1, so pooling one
    // clip must hand it back unchanged (to floating-point precision).
    expect(Math.max(...coverage.values)).toBe(1);
    expect(stats.coverage?.rows).toBe(coverage.rows);
    expect(stats.coverage?.cols).toBe(coverage.cols);
    expect(stats.coverage?.values).toHaveLength(coverage.values.length);
    coverage.values.forEach((value, index) => {
      expect(stats.coverage?.values[index]).toBeCloseTo(value, 9);
    });
  });

  it("ranks the pooled patterns and prints the read-out's own top one first", () => {
    const topPair = A.me.predictability.topPattern.replace(/ \(\d+%\)$/, "");
    expect(stats.topPatterns.length).toBeGreaterThan(0);
    expect(stats.topPatterns.length).toBeLessThanOrEqual(3);
    expect(stats.topPatterns[0]?.pattern).toBe(topPair);
    expect(stats.topPatterns[0]?.count).toBe(A.me.transitions[topPair]);
    expect(stats.topPatterns[0]?.share).toBeCloseTo(
      (A.me.transitions[topPair] ?? 0) / sumValues(A.me.transitions),
      12,
    );
  });

  it("compares against the opponent with the right sign", () => {
    const opponent = A.opponent;
    if (opponent === null) throw new Error("the sample has no opponent");
    expect(stats.versus.clips).toBe(1);
    // Me minus them: negative when the player across the court held the T more.
    expect(stats.versus.tTimeDelta).toBeCloseTo(A.me.tTimePct - opponent.tTimePct, 12);
    expect(stats.versus.predictabilityDelta).toBeCloseTo(
      A.me.predictability.score - opponent.predictability.score,
      12,
    );
    expect(stats.versus.frontShareDelta).toBeCloseTo(
      frontShare(A.me.placement) - frontShare(opponent.placement),
      12,
    );
    expect(Math.sign(stats.versus.tTimeDelta ?? 0)).toBe(Math.sign(A.me.tTimePct - opponent.tTimePct));
  });

  it("lists one trend point, the clip's own numbers", () => {
    expect(stats.trend).toEqual([
      {
        clipId: "clip-a",
        playedAt: "2026-08-13",
        title: "match.mp4",
        tTimePct: A.me.tTimePct,
        predictability: A.me.predictability.score,
        shots: A.me.shots,
        durationSec: A.durationSec,
        avgRallyShots: A.rallies.avgShotsPerRally,
      },
    ]);
  });
});

describe("buildProfileStats — nothing tagged yet", () => {
  it("is empty rather than NaN", () => {
    const stats = buildProfileStats([]);
    expect(stats.recordings).toBe(0);
    expect(stats.tTimePct).toBeNull();
    expect(stats.predictability).toBeNull();
    expect(stats.avgRallyShots).toBeNull();
    expect(stats.coverage).toBeNull();
    expect(stats.frontShare).toBeNull();
    expect(stats.firstPlayedAt).toBeNull();
    expect(stats.lastPlayedAt).toBeNull();
    expect(stats.topPatterns).toEqual([]);
    expect(stats.trend).toEqual([]);
    expect(stats.versus.clips).toBe(0);
    expect(stats.versus.tTimeDelta).toBeNull();
    expect(scoutingNotes(stats)).toEqual([]);
  });
});

describe("buildProfileStats — two clips", () => {
  // Deliberately newest first on the way in, to prove the ordering is the code's.
  const stats = buildProfileStats([CLIP_A, CLIP_B]);
  const opponentA = A.opponent;
  const opponentB = B.opponent;
  if (opponentA === null || opponentB === null) throw new Error("the sample has no opponent");

  it("weights T-time by time and rally length by rallies", () => {
    const byTime =
      (A.me.tTimePct * A.durationSec + B.me.tTimePct * B.durationSec) / (A.durationSec + B.durationSec);
    expect(stats.tTimePct).toBeCloseTo(byTime, 9);
    // The shorter clip has the higher T-time; weighting by time must pull the
    // mean below the plain average, or it was not weighted at all.
    expect(stats.tTimePct ?? 0).toBeLessThan((A.me.tTimePct + B.me.tTimePct) / 2);

    const byRallies =
      (A.rallies.avgShotsPerRally * A.rallies.count + B.rallies.avgShotsPerRally * B.rallies.count) /
      (A.rallies.count + B.rallies.count);
    expect(stats.avgRallyShots).toBeCloseTo(byRallies, 9);
    expect(stats.avgRallyShots).toBeCloseTo((36.56 * 9 + 20 * 3) / 12, 9);

    expect(stats.recordings).toBe(2);
    expect(stats.totalSec).toBeCloseTo(A.durationSec + B.durationSec, 9);
    expect(stats.totalShots).toBe(A.me.shots + B.me.shots);
    expect(stats.totalRallies).toBe(A.rallies.count + B.rallies.count);
    expect(stats.longestRally).toBe(Math.max(A.rallies.longestRally, B.rallies.longestRally));
    expect(stats.qualityPct).toBeCloseTo(A.quality.bothPlayersDetectedPct, 9);
  });

  it("pools the transition matrix and ranks patterns by count, shares of the whole", () => {
    const merged = mergeTransitions(A.me.transitions, B.me.transitions);
    const total = sumValues(merged);
    expect(stats.transitionsTotal).toBe(total);
    expect(stats.predictability).toBe(predictabilityFromTransitions(merged));

    expect(stats.topPatterns.length).toBeLessThanOrEqual(3);
    const counts = stats.topPatterns.map((entry) => entry.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(stats.topPatterns[0]?.count).toBe(Math.max(...Object.values(merged)));
    for (const entry of stats.topPatterns) {
      expect(merged[entry.pattern]).toBe(entry.count);
      expect(entry.share).toBeCloseTo(entry.count / total, 12);
    }
    expect(stats.topPatterns.reduce((sum, entry) => sum + entry.share, 0)).toBeLessThanOrEqual(1);
  });

  it("gives the same predictability for the same clip tagged twice — it is a rate, not a mean", () => {
    const twice = buildProfileStats([CLIP_A, clipOf(A, { id: "clip-a-again" })]);
    expect(Math.abs((twice.predictability ?? 0) - A.me.predictability.score)).toBeLessThanOrEqual(0.002);
  });

  it("sums placement and classes, and compares against both opponents with their weights", () => {
    for (const cell of COURT_CELLS) {
      expect(stats.placement[cell]).toBe(A.me.placement[cell] + B.me.placement[cell]);
    }
    expect(stats.classifiedShots).toBe(A.me.classifiedShots + B.me.classifiedShots);
    expect(stats.shotTypes.drive).toBe(A.me.shotTypes.drive + B.me.shotTypes.drive);

    expect(stats.versus.clips).toBe(2);
    const tDelta =
      ((A.me.tTimePct - opponentA.tTimePct) * A.durationSec +
        (B.me.tTimePct - opponentB.tTimePct) * B.durationSec) /
      (A.durationSec + B.durationSec);
    expect(stats.versus.tTimeDelta).toBeCloseTo(tDelta, 9);
    // A and B are each other's opponents here, so the per-shot-weighted
    // predictability gap cancels exactly and the front-court gap nearly does.
    expect(stats.versus.predictabilityDelta).toBeCloseTo(0, 9);
    const frontDelta =
      ((frontShare(A.me.placement) - frontShare(opponentA.placement)) * A.me.shots +
        (frontShare(B.me.placement) - frontShare(opponentB.placement)) * B.me.shots) /
      (A.me.shots + B.me.shots);
    expect(stats.versus.frontShareDelta).toBeCloseTo(frontDelta, 9);
  });

  it("pools the court plan back onto the peak-is-one convention", () => {
    expect(stats.coverage?.rows).toBe(A.me.coverage?.rows);
    expect(stats.coverage?.cols).toBe(A.me.coverage?.cols);
    expect(stats.coverage?.values).toHaveLength(A.me.coverage?.values.length ?? -1);
    expect(Math.max(...(stats.coverage?.values ?? []))).toBeCloseTo(1, 9);
    for (const value of stats.coverage?.values ?? []) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("lets the commonest grid size win and leaves the odd one out of the plan only", () => {
    const odd = clipOf(
      { ...A, durationSec: 10, me: { ...A.me, coverage: { rows: 2, cols: 2, values: [1, 0, 0, 0] } } },
      { id: "clip-odd", durationSec: 10 },
    );
    const mixed = buildProfileStats([CLIP_A, CLIP_B, odd]);
    expect(mixed.coverage?.rows).toBe(A.me.coverage?.rows);
    expect(mixed.coverage?.cols).toBe(A.me.coverage?.cols);
    expect(mixed.recordings).toBe(3);
    expect(mixed.totalShots).toBe(A.me.shots * 2 + B.me.shots);
  });

  it("orders the trend by when the match was played, oldest first", () => {
    expect(stats.trend.map((point) => point.clipId)).toEqual(["clip-b", "clip-a"]);
    expect(stats.trend.map((point) => point.playedAt)).toEqual(["2026-07-02", "2026-08-13"]);
    expect(stats.trend[0]?.title).toBe("earlier.mp4");
    expect(stats.trend[0]?.durationSec).toBe(300);
    expect(stats.firstPlayedAt).toBe("2026-07-02");
    expect(stats.lastPlayedAt).toBe("2026-08-13");
  });
});

describe("sortChronologically", () => {
  it("sorts by played date, ties by when the tag was made, without touching the input", () => {
    const sameDayLater = clipOf(A, { id: "later-tag", playedAt: "2026-07-02", createdAt: "2026-07-03T00:00:00.000Z" });
    const input = [CLIP_A, sameDayLater, CLIP_B];
    const sorted = sortChronologically(input);
    expect(sorted.map((clip) => clip.id)).toEqual(["clip-b", "later-tag", "clip-a"]);
    expect(input.map((clip) => clip.id)).toEqual(["clip-a", "later-tag", "clip-b"]);
  });
});

describe("predictabilityFromTransitions", () => {
  it("is null with nothing to measure, 1 when every move is the same, 0 when every move is a coin toss", () => {
    expect(predictabilityFromTransitions({})).toBeNull();
    expect(predictabilityFromTransitions({ "backLeft -> backLeft": 12 })).toBe(1);
    // Two deterministic rows are still fully predictable given where you are.
    expect(
      predictabilityFromTransitions({ "backLeft -> frontRight": 5, "frontRight -> backLeft": 5 }),
    ).toBe(1);
    // One row spread evenly over all four cells is 2 bits — the maximum.
    expect(
      predictabilityFromTransitions({
        "backLeft -> frontLeft": 3,
        "backLeft -> frontRight": 3,
        "backLeft -> backLeft": 3,
        "backLeft -> backRight": 3,
      }),
    ).toBe(0);
  });

  it("is the sample's own score, to the pipeline's rounding", () => {
    expect(predictabilityFromTransitions(A.me.transitions)).toBe(A.me.predictability.score);
    expect(predictabilityFromTransitions(summaryOf("B").me.transitions)).toBe(
      summaryOf("B").me.predictability.score,
    );
  });
});

describe("calendarWeeks", () => {
  // A Friday, mid-morning local time. The calendar is in the tagger's local days.
  const TODAY = new Date(2026, 7, 21, 10, 30);
  const weekday = (day: string) => new Date(`${day}T00:00:00`).getDay();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  it("lays out 52 Monday-first columns ending on the week of today", () => {
    const calendar = calendarWeeks([], TODAY, 52);
    expect(calendar.weeks).toHaveLength(52);
    for (const column of calendar.weeks) {
      expect(column).toHaveLength(7);
      expect(weekday(column[0]?.date ?? "")).toBe(1);
      expect(weekday(column[6]?.date ?? "")).toBe(0);
    }
    expect(calendar.weeks[0]?.[0]?.date).toBe("2025-08-25");
    const last = calendar.weeks[51];
    expect(last?.[0]?.date).toBe("2026-08-17");
    expect(last?.[4]?.date).toBe("2026-08-21");
    expect(last?.map((cell) => cell.inRange)).toEqual([true, true, true, true, true, false, false]);
    // Every earlier column is wholly in the past.
    expect(calendar.weeks.slice(0, 51).every((column) => column.every((cell) => cell.inRange))).toBe(true);
    expect(calendar.max).toBe(0);
    expect(calendar.inWindow).toBe(0);
  });

  it("lights today's cell in the last column, full brightness for the only recording", () => {
    const today = clipOf(A, { id: "today", playedAt: "2026-08-21", title: "Friday league" });
    const calendar = calendarWeeks([today], TODAY, 52);
    const cell = calendar.weeks[51]?.[4];
    expect(cell?.date).toBe("2026-08-21");
    expect(cell?.count).toBe(1);
    expect(cell?.level).toBe(4);
    expect(cell?.minutes).toBeCloseTo(A.durationSec / 60, 9);
    expect(cell?.titles).toEqual(["Friday league"]);
    expect(calendar.max).toBe(1);
    expect(calendar.inWindow).toBe(1);
    // Nothing else lit.
    const lit = calendar.weeks.flat().filter((day) => day.count > 0);
    expect(lit).toHaveLength(1);
  });

  it("scales levels to the busiest day", () => {
    const clips = [
      clipOf(A, { id: "one", playedAt: "2026-08-21" }),
      clipOf(B, { id: "two", playedAt: "2026-08-21" }),
      clipOf(A, { id: "three", playedAt: "2026-08-13" }),
    ];
    const calendar = calendarWeeks(clips, TODAY, 52);
    expect(calendar.max).toBe(2);
    expect(calendar.inWindow).toBe(3);
    const friday = calendar.weeks[51]?.[4];
    expect(friday?.count).toBe(2);
    expect(friday?.level).toBe(4);
    expect(friday?.minutes).toBeCloseTo((A.durationSec + B.durationSec) / 60, 9);
    // Aug 13 is the Thursday of the week before.
    const thursday = calendar.weeks[50]?.[3];
    expect(thursday?.date).toBe("2026-08-13");
    expect(thursday?.count).toBe(1);
    expect(thursday?.level).toBe(2);
  });

  it("labels each month once, over the column its first Monday falls in", () => {
    const calendar = calendarWeeks([], TODAY, 52);
    expect(calendar.months.map((month) => month.label)).toEqual([
      "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
    ]);
    for (let index = 1; index < calendar.months.length; index += 1) {
      expect(calendar.months[index]?.col ?? -1).toBeGreaterThan(calendar.months[index - 1]?.col ?? -1);
    }
    for (const month of calendar.months) {
      const monday = calendar.weeks[month.col]?.[0]?.date ?? "";
      expect(MONTHS[new Date(`${monday}T00:00:00`).getMonth()]).toBe(month.label);
    }
    // The first column starts on 25 Aug — too far into its month for a label
    // that would sit half off the grid. Start within the first week and it gets one.
    expect(calendar.months[0]?.col).toBe(1);
    expect(calendarWeeks([], new Date(2026, 7, 5), 1).months).toEqual([{ col: 0, label: "Aug" }]);
  });

  it("counts only recordings that fall inside the window, and not tomorrow's", () => {
    const clips = [
      clipOf(A, { id: "before", playedAt: "2025-08-24" }), // the Sunday before the first column
      clipOf(A, { id: "first-day", playedAt: "2025-08-25" }),
      clipOf(A, { id: "today", playedAt: "2026-08-21" }),
      clipOf(A, { id: "tomorrow", playedAt: "2026-08-22" }), // drawn blank, not counted
    ];
    const calendar = calendarWeeks(clips, TODAY, 52);
    expect(calendar.inWindow).toBe(2);
    expect(calendar.weeks[0]?.[0]?.count).toBe(1);
    expect(calendar.weeks[51]?.[5]?.count).toBe(0);
    expect(calendar.weeks[51]?.[5]?.inRange).toBe(false);
    expect(calendar.weeks.flat().some((day) => day.date === "2025-08-24")).toBe(false);
  });
});

describe("scoutingNotes", () => {
  const BASE = buildProfileStats([CLIP_A]);

  /** A profile the rules have nothing to say about; each test turns one dial. */
  const QUIET: Partial<ProfileStats> = {
    tTimePct: 25,
    versus: { clips: 0, tTimeDelta: null, predictabilityDelta: null, frontShareDelta: null },
    predictability: 0.2,
    frontShare: 0.25,
    leftShare: 0.5,
    avgRallyShots: 15,
  };

  function quiet(overrides: Partial<ProfileStats> = {}): ProfileStats {
    return { ...BASE, ...QUIET, ...overrides };
  }

  function ids(stats: ProfileStats): string[] {
    return scoutingNotes(stats).map((note) => note.id);
  }

  const CLASSES: ShotTypeCounts = {
    serve: 0,
    drive: 2,
    crossCourt: 12,
    drop: 5,
    boast: 4,
    volley: 7,
    unknown: 0,
  };

  it("says nothing under the minimum sample, and nothing on a quiet profile", () => {
    // Guard the premise: the quiet profile clears the sample minimum, so its
    // silence is the rules' doing and not the gate's.
    expect(BASE.totalShots).toBeGreaterThanOrEqual(MIN_SHOTS_FOR_NOTES);
    expect(ids(quiet())).toEqual([]);
    expect(ids({ ...BASE, totalShots: MIN_SHOTS_FOR_NOTES - 1 })).toEqual([]);
    expect(ids(buildProfileStats([]))).toEqual([]);
  });

  it("reads the real sample: rarely short — from position; rally length is never a note", () => {
    // Guard the premise so this says something about the rules, not the file.
    expect(BASE.frontShare ?? 1).toBeLessThanOrEqual(0.18);
    // The sample's rally segmentation undercounts (a 36-shot "average rally");
    // the rules must not turn that artefact into a claim about the person.
    expect(BASE.avgRallyShots ?? 0).toBeGreaterThanOrEqual(25);
    const notes = scoutingNotes(BASE);
    expect(notes.map((note) => note.id)).toEqual(["depth-deep"]);
    expect(notes.every((note) => note.basis === "position")).toBe(true);
    expect(notes[0]?.detail).toContain("over 1 recording");
  });

  it("rates the T against the opponents when there is one, else on its own", () => {
    const slow = scoutingNotes(
      quiet({ versus: { clips: 1, tTimeDelta: -8, predictabilityDelta: null, frontShareDelta: null } }),
    );
    expect(slow.map((note) => note.id)).toEqual(["t-slow"]);
    expect(slow[0]?.basis).toBe("position");
    expect(slow[0]?.detail).toMatch(/against \d+% for the players across the court/);

    const owns = quiet({ versus: { clips: 1, tTimeDelta: 8, predictabilityDelta: null, frontShareDelta: null } });
    expect(ids(owns)).toEqual(["t-owns"]);
    // Under five points either way the comparison is not worth a sentence.
    const even = quiet({ versus: { clips: 1, tTimeDelta: 4, predictabilityDelta: null, frontShareDelta: null } });
    expect(ids(even)).toEqual([]);

    expect(ids(quiet({ tTimePct: 15 }))).toEqual(["t-low"]);
    expect(ids(quiet({ tTimePct: 40 }))).toEqual(["t-high"]);
    expect(ids(quiet({ tTimePct: null }))).toEqual([]);
  });

  it("calls a repeated pattern, or an unreadable one, from the pooled matrix", () => {
    const repeat = scoutingNotes(quiet({ predictability: 0.35 }));
    expect(repeat.map((note) => note.id)).toEqual(["pattern-repeat"]);
    expect(repeat[0]?.basis).toBe("position");
    expect(repeat[0]?.title).toContain("back right → back right");
    // A dominant pattern is enough on its own, whatever the score.
    const top = BASE.topPatterns[0];
    if (top === undefined) throw new Error("no top pattern");
    expect(ids(quiet({ topPatterns: [{ ...top, share: 0.3 }] }))).toEqual(["pattern-repeat"]);
    expect(ids(quiet({ predictability: 0.1 }))).toEqual(["pattern-varied"]);
    // Too few transitions to call either way.
    expect(ids(quiet({ predictability: 0.35, transitionsTotal: 29 }))).toEqual([]);
  });

  it("reads depth and side from where the shots were taken, above a minimum", () => {
    const deep = scoutingNotes(quiet({ frontShare: 0.1 }));
    expect(deep.map((note) => note.id)).toEqual(["depth-deep"]);
    expect(deep[0]?.basis).toBe("position");
    expect(deep[0]?.detail).toContain("10% of their shots went to the front court");
    expect(ids(quiet({ frontShare: 0.4 }))).toEqual(["depth-short"]);
    expect(ids(quiet({ leftShare: 0.7 }))).toEqual(["side-left"]);
    expect(ids(quiet({ leftShare: 0.3 }))).toEqual(["side-right"]);
    expect(ids(quiet({ frontShare: 0.1, leftShare: 0.7, placementTotal: MIN_SHOTS_FOR_NOTES - 1 }))).toEqual([]);
  });

  it("never turns rally length into a note (rally boundaries are unaudited)", () => {
    expect(ids(quiet({ avgRallyShots: 30, totalRallies: 40 }))).toEqual([]);
    expect(ids(quiet({ avgRallyShots: 5, totalRallies: 40 }))).toEqual([]);
  });

  it("reads shot classes only above the classified minimum, and says so", () => {
    const silent = quiet({ shotTypes: CLASSES, classifiedShots: MIN_CLASSIFIED_FOR_NOTES - 1 });
    expect(ids(silent)).toEqual([]);

    const notes = scoutingNotes(quiet({ shotTypes: CLASSES, classifiedShots: MIN_CLASSIFIED_FOR_NOTES }));
    expect(notes.map((note) => note.id)).toEqual([
      "class-cross",
      "class-drops",
      "class-boasts",
      "class-volleys",
    ]);
    for (const note of notes) {
      expect(note.basis).toBe("classes");
      // A class-based claim is worded as a reading, never as a measurement.
      expect(note.detail).toMatch(/read as/);
    }
    const noDrops = quiet({
      shotTypes: { ...CLASSES, crossCourt: 0, drop: 0, boast: 0, volley: 0, drive: 30 },
      classifiedShots: 30,
    });
    expect(ids(noDrops)).toEqual(["class-no-drops"]);
  });

  it("never says more than six things, position first", () => {
    const loud = quiet({
      versus: { clips: 2, tTimeDelta: -8, predictabilityDelta: null, frontShareDelta: null },
      predictability: 0.35,
      frontShare: 0.1,
      leftShare: 0.7,
      avgRallyShots: 30,
      shotTypes: CLASSES,
      classifiedShots: 30,
    });
    const notes = scoutingNotes(loud);
    expect(notes).toHaveLength(6);
    expect(notes.map((note) => note.id)).toEqual([
      "t-slow",
      "pattern-repeat",
      "depth-deep",
      "side-left",
      "class-cross",
      "class-drops",
    ]);
    const firstClasses = notes.findIndex((note) => note.basis === "classes");
    expect(notes.slice(0, firstClasses).every((note) => note.basis === "position")).toBe(true);
    expect(notes[0]?.detail).toContain("over 1 recording");
  });
});
