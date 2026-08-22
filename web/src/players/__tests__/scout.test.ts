/**
 * The opponent brief, built from the REAL sample analysis the same way the
 * coach page builds it (summarizeClip → buildProfileStats → scoutingNotes →
 * opponentBrief), so what the coach is told is cross-checked against what the
 * profile page computes rather than against invented numbers.
 *
 * The caps matter as much as the values: the server re-validates every field
 * with the same limits, and a brief that exceeded them would be silently
 * trimmed server-side — so the client must never produce one that does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COURT_CELLS, SHOT_TYPES, parseAnalysisValue, type MatchAnalysis } from "../../analysis/types";
import { buildProfileStats, scoutingNotes, type ScoutingNote } from "../aggregate";
import {
  BRIEF_DETAIL_MAX,
  BRIEF_MAX_NOTES,
  BRIEF_MAX_PATTERNS,
  BRIEF_MAX_SHOT_TYPES,
  BRIEF_NAME_MAX,
  BRIEF_TITLE_MAX,
  briefToText,
  opponentBrief,
} from "../scout";
import { summarizeClip, type ClipSummary, type Player, type PlayerClip } from "../shape";

const SAMPLE_PATH = join(__dirname, "..", "..", "..", "public", "sample", "analysis.json");

const REAL: MatchAnalysis = (() => {
  const parsed = parseAnalysisValue(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
  if (parsed === null) throw new Error("the bundled sample analysis no longer parses");
  return parsed;
})();

const CELL_PAIR = new RegExp(`^(${COURT_CELLS.join("|")}) -> (${COURT_CELLS.join("|")})$`);

function summaryOf(side: "A" | "B"): ClipSummary {
  const summary = summarizeClip(REAL, side);
  if (summary === null) throw new Error(`the sample has no side ${side}`);
  return summary;
}

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
    posterPath: null,
    analysisPath: null,
    createdAt: "2026-08-13T12:00:00.000Z",
    ...overrides,
  };
}

function playerOf(overrides: Partial<Player> = {}): Player {
  return {
    id: "player-1",
    name: "Ali Farag",
    hand: "right",
    notes: "",
    shareToken: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Decimal places of a number as it prints — 0.123 → 3, 12.5 → 1, 7 → 0. */
function decimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

const SUMMARY_A = summaryOf("A");
const SUMMARY_B = summaryOf("B");

describe("opponentBrief, from the real sample", () => {
  // Two clips so every pooled quantity (T-time vs opponents, patterns, the
  // mix, the notes) has something to pool.
  const clips = [
    clipOf(SUMMARY_A),
    clipOf(SUMMARY_B, { id: "clip-b", side: "B", playedAt: "2026-08-06" }),
  ];
  const stats = buildProfileStats(clips);
  const notes = scoutingNotes(stats);
  const brief = opponentBrief(playerOf(), stats, notes);

  it("carries the profile's own headline numbers, rounded", () => {
    expect(brief.name).toBe("Ali Farag");
    expect(brief.hand).toBe("right");
    expect(brief.recordings).toBe(2);
    expect(brief.minutes).toBe(Math.round((stats.totalSec / 60) * 10) / 10);
    expect(brief.shots).toBe(SUMMARY_A.me.shots + SUMMARY_B.me.shots);
    expect(brief.classifiedShots).toBe(SUMMARY_A.me.classifiedShots + SUMMARY_B.me.classifiedShots);

    expect(stats.tTimePct).not.toBeNull();
    expect(brief.tTimePct).toBe(Math.round((stats.tTimePct ?? 0) * 10) / 10);
    expect(decimals(brief.tTimePct ?? 0)).toBeLessThanOrEqual(1);

    // Both clips had an opponent, so the T-time comparison is populated.
    expect(brief.tTimeVsOpponents).not.toBeNull();
    expect(decimals(brief.tTimeVsOpponents ?? 0)).toBeLessThanOrEqual(1);

    expect(brief.predictability).not.toBeNull();
    expect(brief.predictability).toBeGreaterThanOrEqual(0);
    expect(brief.predictability).toBeLessThanOrEqual(1);
    expect(decimals(brief.predictability ?? 0)).toBeLessThanOrEqual(3);
  });

  it("keeps at most three patterns in the contract grammar, with 3 dp shares", () => {
    expect(brief.topPatterns.length).toBeGreaterThan(0);
    expect(brief.topPatterns.length).toBeLessThanOrEqual(BRIEF_MAX_PATTERNS);
    let sum = 0;
    for (const top of brief.topPatterns) {
      expect(top.pattern).toMatch(CELL_PAIR);
      expect(top.share).toBeGreaterThan(0);
      expect(top.share).toBeLessThanOrEqual(1);
      expect(decimals(top.share)).toBeLessThanOrEqual(3);
      sum += top.share;
    }
    expect(sum).toBeLessThanOrEqual(1.001);
    expect(brief.topPatterns[0]?.pattern).toBe(stats.topPatterns[0]?.pattern);
  });

  it("placement shares are fractions of the pooled placement", () => {
    expect(brief.frontShare).not.toBeNull();
    expect(brief.leftShare).not.toBeNull();
    expect(brief.frontShare).toBeCloseTo(stats.frontShare ?? -1, 3);
    expect(brief.leftShare).toBeCloseTo(stats.leftShare ?? -1, 3);
    expect(decimals(brief.frontShare ?? 0)).toBeLessThanOrEqual(3);
  });

  it("the shot mix lists only classes that occurred, over the classified shots, at most six", () => {
    expect(brief.shotMix.length).toBeGreaterThan(0);
    expect(brief.shotMix.length).toBeLessThanOrEqual(BRIEF_MAX_SHOT_TYPES);
    const seen = new Set<string>();
    for (const item of brief.shotMix) {
      expect((SHOT_TYPES as readonly string[]).includes(item.type)).toBe(true);
      expect(item.share).toBeGreaterThan(0);
      expect(decimals(item.share)).toBeLessThanOrEqual(3);
      expect(seen.has(item.type)).toBe(false);
      seen.add(item.type);
    }
    // Most frequent first — the same order the profile's bars draw.
    const counts = brief.shotMix.map((item) => item.share);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // Every class with a count is in the mix (the sample has fewer than six).
    const present = SHOT_TYPES.filter((type) => stats.shotTypes[type] > 0);
    expect(brief.shotMix.map((item) => item.type).sort()).toEqual([...present].sort());
  });

  it("carries the profile's scouting notes, basis and all", () => {
    expect(notes.length).toBeGreaterThan(0);
    expect(brief.notes).toHaveLength(Math.min(notes.length, BRIEF_MAX_NOTES));
    brief.notes.forEach((note, index) => {
      expect(note.title).toBe(notes[index]?.title);
      expect(note.detail).toBe(notes[index]?.detail);
      expect(["position", "classes"]).toContain(note.basis);
      expect(note.title.length).toBeLessThanOrEqual(BRIEF_TITLE_MAX);
      expect(note.detail.length).toBeLessThanOrEqual(BRIEF_DETAIL_MAX);
    });
  });

  it("survives a JSON round trip unchanged — it is what goes over the wire", () => {
    expect(JSON.parse(JSON.stringify(brief))).toEqual(brief);
  });
});

describe("opponentBrief caps", () => {
  const stats = buildProfileStats([clipOf(SUMMARY_A)]);

  it("caps a 200-character name at the name limit", () => {
    const brief = opponentBrief(playerOf({ name: "x".repeat(200) }), stats, []);
    expect(brief.name).toHaveLength(BRIEF_NAME_MAX);
  });

  it("keeps at most six notes and caps each title and detail", () => {
    const many: ScoutingNote[] = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      title: `Title ${i} `.repeat(40),
      detail: `Detail ${i} `.repeat(100),
      basis: i % 2 === 0 ? "position" : "classes",
    }));
    const brief = opponentBrief(playerOf(), stats, many);
    expect(brief.notes).toHaveLength(BRIEF_MAX_NOTES);
    for (const note of brief.notes) {
      expect(note.title).toHaveLength(BRIEF_TITLE_MAX);
      expect(note.detail).toHaveLength(BRIEF_DETAIL_MAX);
    }
    expect(brief.notes[0]?.basis).toBe("position");
    expect(brief.notes[1]?.basis).toBe("classes");
  });

  it("a player with no clips is all nulls and empties, never NaN", () => {
    const empty = buildProfileStats([]);
    const brief = opponentBrief(playerOf({ hand: null }), empty, scoutingNotes(empty));
    expect(brief).toEqual({
      name: "Ali Farag",
      hand: null,
      recordings: 0,
      minutes: 0,
      shots: 0,
      tTimePct: null,
      tTimeVsOpponents: null,
      predictability: null,
      topPatterns: [],
      frontShare: null,
      leftShare: null,
      shotMix: [],
      classifiedShots: 0,
      notes: [],
    });
  });

  it("a one-player clip leaves the T-time comparison null", () => {
    const alone = clipOf({ ...SUMMARY_A, opponent: null });
    const brief = opponentBrief(playerOf(), buildProfileStats([alone]), []);
    expect(brief.tTimeVsOpponents).toBeNull();
    expect(brief.tTimePct).not.toBeNull();
  });
});

describe("briefToText", () => {
  it("reads back the brief in plain English with the caveats on their sleeves", () => {
    const clips = [clipOf(SUMMARY_A), clipOf(SUMMARY_B, { id: "clip-b", side: "B" })];
    const stats = buildProfileStats(clips);
    const notes = scoutingNotes(stats);
    const brief = opponentBrief(playerOf(), stats, notes);
    const text = briefToText(brief);

    expect(text).toContain("Ali Farag (right-handed): 2 recordings");
    expect(text).toContain("Within 1.5 m of the T");
    expect(text).toContain("Predictability");
    expect(text).toContain("after a shot to the");
    expect(text).toContain("where the ball was retrieved");
    expect(text).toContain("no ball tracking");
    expect(text).toContain("indicative");
    for (const note of brief.notes) expect(text).toContain(note.title);
    expect(text).toContain("not a human's scouting report");
    // Machine cell names never reach the person.
    expect(text).not.toMatch(/backLeft|frontRight|crossCourt/);
  });

  it("says plainly when there is nothing to say", () => {
    const empty = buildProfileStats([]);
    const text = briefToText(opponentBrief(playerOf({ hand: null }), empty, []));
    expect(text).toBe("Ali Farag: no footage tagged yet, so the coach has the name and nothing else.");
  });
});
