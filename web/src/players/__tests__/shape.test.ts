/**
 * The profile domain, exercised against the REAL analysis file shipped as the
 * demo sample — not a hand-made object. `summarizeClip` is the one place an
 * analysis is reduced to what a profile keeps, and the numbers it keeps are
 * cross-checked against the file's own (per-player shot counts, the shots
 * array, which shots carry a class) so a drift in either direction shows up
 * here before it shows up as a wrong profile.
 *
 * The narrowing tests are the same discipline as the analysis parser's: a
 * structurally broken summary is null (the clip is left out), auxiliary
 * detail degrades on its own, and a bad row never takes the page down.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COURT_CELLS, parseAnalysisValue, type MatchAnalysis } from "../../analysis/types";
import {
  CLIP_SUMMARY_VERSION,
  PLAYER_NAME_MAX,
  fromClipRow,
  fromPlayerRow,
  isIsoDay,
  isoDay,
  parseClipSummary,
  summarizeClip,
  validatePlayerName,
  type ClipSummary,
} from "../shape";

const SAMPLE_PATH = join(__dirname, "..", "..", "..", "public", "sample", "analysis.json");

const REAL: MatchAnalysis = (() => {
  const parsed = parseAnalysisValue(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
  if (parsed === null) throw new Error("the bundled sample analysis no longer parses");
  return parsed;
})();

const CELL_PAIR = new RegExp(`^(${COURT_CELLS.join("|")}) -> (${COURT_CELLS.join("|")})$`);

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

/** A summary of the sample's side A; a fresh copy each time so tests may mutate it. */
function sampleSummary(): ClipSummary {
  const summary = summarizeClip(REAL, "A");
  if (summary === null) throw new Error("the sample has no side A");
  return summary;
}

/** The JSON a summary becomes in the database and comes back as. */
function roundTrip(summary: ClipSummary): unknown {
  return JSON.parse(JSON.stringify(summary)) as unknown;
}

/** A `player_clips` row as PostgREST hands it back, with overrides. */
function clipRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "clip-1",
    player_id: "player-1",
    side: "A",
    title: "match.mp4",
    job_id: "job-1",
    history_id: "hist-1",
    played_at: "2026-08-21",
    duration_sec: 451.45,
    shots: 156,
    summary: roundTrip(sampleSummary()),
    created_at: "2026-08-21T14:03:00.000Z",
    ...overrides,
  };
}

describe("summarizeClip", () => {
  it.each(["A", "B"] as const)("keeps side %s's numbers and its opponent's, from the real file", (side) => {
    const summary = summarizeClip(REAL, side);
    expect(summary).not.toBeNull();
    if (summary === null) return;

    const mine = REAL.players.find((p) => p.id === side);
    const theirs = REAL.players.find((p) => p.id !== side);
    expect(mine).toBeDefined();
    expect(theirs).toBeDefined();
    if (mine === undefined || theirs === undefined) return;

    expect(summary.v).toBe(CLIP_SUMMARY_VERSION);
    expect(summary.schemaVersion).toBe(REAL.schemaVersion);
    expect(summary.durationSec).toBe(REAL.video.durationSec);
    expect(summary.rallies).toEqual(REAL.rallies);
    expect(summary.quality.framesAnalyzed).toBe(REAL.quality.framesAnalyzed);
    expect(summary.quality.bothPlayersDetectedPct).toBe(REAL.quality.bothPlayersDetectedPct);
    expect(summary.quality.audioAvailable).toBe(REAL.quality.audioAvailable);

    // The tagged side keeps everything, the heatmap included; the opponent
    // keeps the numbers the comparison reads and not the map nobody draws.
    expect(summary.me.label).toBe(mine.label);
    expect(summary.me.shots).toBe(mine.shots);
    expect(summary.me.placement).toEqual(mine.placement);
    expect(summary.me.tTimePct).toBe(mine.tTimePct);
    expect(summary.me.predictability).toEqual(mine.predictability);
    expect(summary.me.coverage).toEqual(mine.coverageHeatmap);
    expect(summary.me.coverage).not.toBe(mine.coverageHeatmap); // a copy, not a reference

    expect(summary.opponent).not.toBeNull();
    expect(summary.opponent?.label).toBe(theirs.label);
    expect(summary.opponent?.shots).toBe(theirs.shots);
    expect(summary.opponent?.placement).toEqual(theirs.placement);
    expect(summary.opponent?.tTimePct).toBe(theirs.tTimePct);
    expect(summary.opponent?.coverage).toBeNull();
  });

  it.each(["A", "B"] as const)("derives side %s's transitions and classes from the shots array", (side) => {
    const summary = summarizeClip(REAL, side);
    if (summary === null) throw new Error("no summary");
    const ownShots = REAL.shots.filter((shot) => shot.player === side);
    // Guard the premise: the sample must carry this side's shots, classified,
    // or the assertions below would pass on empty records and prove nothing.
    expect(ownShots.length).toBeGreaterThan(100);
    expect(ownShots.every((shot) => shot.type !== undefined)).toBe(true);

    // One transition per consecutive pair of this player's own shots.
    expect(sumValues(summary.me.transitions)).toBe(ownShots.length - 1);
    for (const [key, count] of Object.entries(summary.me.transitions)) {
      expect(key).toMatch(CELL_PAIR);
      expect(count).toBeGreaterThan(0);
    }
    // The file's own top pattern is written in the same grammar and is one of
    // the busiest pairs here — the two were computed from the same sequence.
    const topPair = summary.me.predictability.topPattern.replace(/ \(\d+%\)$/, "");
    const busiest = Math.max(...Object.values(summary.me.transitions));
    expect(topPair).toMatch(CELL_PAIR);
    expect(summary.me.transitions[topPair]).toBe(busiest);

    const classified = ownShots.filter((shot) => shot.type !== undefined).length;
    expect(summary.me.classifiedShots).toBe(classified);
    expect(sumValues(summary.me.shotTypes)).toBe(classified);
    for (const shot of ownShots) {
      if (shot.type === undefined) continue;
      expect(summary.me.shotTypes[shot.type]).toBe(
        ownShots.filter((other) => other.type === shot.type).length,
      );
    }
  });

  it("counts no classes for a v1 file, and the transitions still", () => {
    const v1: MatchAnalysis = {
      ...REAL,
      schemaVersion: 1,
      shots: REAL.shots.map(({ tSec, player, cell }) => ({ tSec, player, cell })),
    };
    const summary = summarizeClip(v1, "A");
    expect(summary?.schemaVersion).toBe(1);
    expect(summary?.me.classifiedShots).toBe(0);
    expect(sumValues(summary?.me.shotTypes ?? {})).toBe(0);
    expect(sumValues(summary?.me.transitions ?? {})).toBe(
      REAL.shots.filter((shot) => shot.player === "A").length - 1,
    );
  });

  it("has no opponent for a one-player analysis, and no summary for the side that is not there", () => {
    const solo: MatchAnalysis = { ...REAL, players: REAL.players.filter((p) => p.id === "A") };
    expect(summarizeClip(solo, "A")?.opponent).toBeNull();
    expect(summarizeClip(solo, "B")).toBeNull();
  });
});

describe("parseClipSummary", () => {
  it("reads back exactly what was written, through JSON", () => {
    const original = sampleSummary();
    expect(parseClipSummary(roundTrip(original))).toEqual(original);

    const sideB = summarizeClip(REAL, "B");
    expect(parseClipSummary(roundTrip(sideB as ClipSummary))).toEqual(sideB);
  });

  it("rejects a summary it has no reader for", () => {
    const summary = roundTrip(sampleSummary()) as Record<string, unknown>;
    expect(parseClipSummary({ ...summary, v: 2 })).toBeNull();
    expect(parseClipSummary({ ...summary, v: undefined })).toBeNull();
    expect(parseClipSummary({ ...summary, v: "1" })).toBeNull();
  });

  it("rejects a summary without the tagged side, or with a broken placement", () => {
    const summary = roundTrip(sampleSummary()) as Record<string, unknown>;
    const me = summary.me as Record<string, unknown>;
    expect(parseClipSummary({ ...summary, me: undefined })).toBeNull();
    expect(parseClipSummary({ ...summary, me: null })).toBeNull();
    expect(parseClipSummary({ ...summary, me: { ...me, placement: undefined } })).toBeNull();
    // A missing cell, and a count that is not one — both mean "not a placement".
    const placement = me.placement as Record<string, unknown>;
    expect(
      parseClipSummary({ ...summary, me: { ...me, placement: { ...placement, backLeft: undefined } } }),
    ).toBeNull();
    expect(
      parseClipSummary({ ...summary, me: { ...me, placement: { ...placement, frontLeft: -1 } } }),
    ).toBeNull();
    expect(parseClipSummary({ ...summary, me: { ...me, predictability: undefined } })).toBeNull();
    expect(parseClipSummary("not even an object")).toBeNull();
    expect(parseClipSummary(null)).toBeNull();
  });

  it("drops a mis-sized heatmap alone and keeps the numbers", () => {
    const original = sampleSummary();
    const summary = roundTrip(original) as Record<string, unknown>;
    const me = summary.me as Record<string, unknown>;
    const coverage = me.coverage as { rows: number; cols: number; values: number[] };
    const parsed = parseClipSummary({
      ...summary,
      me: { ...me, coverage: { ...coverage, values: coverage.values.slice(1) } },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.me.coverage).toBeNull();
    expect(parsed?.me.shots).toBe(original.me.shots);
    expect(parsed?.me.placement).toEqual(original.me.placement);
    expect(parsed?.me.predictability).toEqual(original.me.predictability);
    expect(parsed?.me.transitions).toEqual(original.me.transitions);
    expect(parsed?.opponent).toEqual(original.opponent);
  });

  it("reads missing classes and transitions as none, and an absent opponent as null", () => {
    const original = sampleSummary();
    const summary = roundTrip(original) as Record<string, unknown>;
    const me = summary.me as Record<string, unknown>;
    const parsed = parseClipSummary({
      ...summary,
      opponent: undefined,
      me: { ...me, shotTypes: undefined, classifiedShots: undefined, transitions: undefined },
    });
    expect(parsed?.opponent).toBeNull();
    expect(parsed?.me.classifiedShots).toBe(0);
    expect(sumValues(parsed?.me.shotTypes ?? {})).toBe(0);
    expect(parsed?.me.transitions).toEqual({});
    // A transition key outside the cell grammar is skipped, not fatal.
    const odd = parseClipSummary({
      ...summary,
      me: { ...me, transitions: { "backLeft -> frontRight": 3, "nowhere -> backLeft": 2, "frontLeft": 1 } },
    });
    expect(odd?.me.transitions).toEqual({ "backLeft -> frontRight": 3 });
  });
});

describe("row narrowing", () => {
  it("reads a players row, reading an unknown hand as none", () => {
    const player = fromPlayerRow({
      id: "p-1",
      user_id: "u-1",
      name: "  Asha  ",
      hand: "left",
      notes: null,
      created_at: "2026-08-01T09:00:00+00:00",
      updated_at: "2026-08-02T09:00:00+00:00",
    });
    expect(player).toEqual({
      id: "p-1",
      name: "Asha",
      hand: "left",
      shareToken: null,
      notes: "",
      createdAt: "2026-08-01T09:00:00+00:00",
      updatedAt: "2026-08-02T09:00:00+00:00",
    });
    expect(fromPlayerRow({ id: "p-2", name: "Ben", hand: "ambidextrous" })?.hand).toBeNull();
    expect(fromPlayerRow({ id: "p-2", name: "Ben", created_at: "yesterday-ish" })?.createdAt).toBe("");
  });

  it("refuses a players row without an id or a name", () => {
    expect(fromPlayerRow({ name: "Nobody" })).toBeNull();
    expect(fromPlayerRow({ id: "", name: "Nobody" })).toBeNull();
    expect(fromPlayerRow({ id: "p-3", name: "   " })).toBeNull();
    expect(fromPlayerRow({ id: "p-3" })).toBeNull();
    expect(fromPlayerRow(null)).toBeNull();
    expect(fromPlayerRow(["p-3", "Nobody"])).toBeNull();
  });

  it("reads a player_clips row, slicing a timestamped played_at to the day", () => {
    const clip = fromClipRow(clipRow({ played_at: "2026-08-21T00:00:00+00:00" }));
    expect(clip).not.toBeNull();
    expect(clip?.id).toBe("clip-1");
    expect(clip?.playerId).toBe("player-1");
    expect(clip?.side).toBe("A");
    expect(clip?.title).toBe("match.mp4");
    expect(clip?.jobId).toBe("job-1");
    expect(clip?.historyId).toBe("hist-1");
    expect(clip?.playedAt).toBe("2026-08-21");
    expect(clip?.durationSec).toBe(451.45);
    expect(clip?.shots).toBe(156);
    expect(clip?.createdAt).toBe("2026-08-21T14:03:00.000Z");
    expect(clip?.summary).toEqual(sampleSummary());
  });

  it("falls back to the summary's own duration and shots, and reads empty ids as none", () => {
    const clip = fromClipRow(
      clipRow({ duration_sec: undefined, shots: undefined, job_id: "", history_id: null, title: undefined }),
    );
    expect(clip?.durationSec).toBe(REAL.video.durationSec);
    expect(clip?.shots).toBe(REAL.players[0]?.shots);
    expect(clip?.jobId).toBeNull();
    expect(clip?.historyId).toBeNull();
    expect(clip?.title).toBe("");
  });

  it("refuses a player_clips row it cannot trust", () => {
    expect(fromClipRow(clipRow({ side: "C" }))).toBeNull();
    expect(fromClipRow(clipRow({ side: undefined }))).toBeNull();
    expect(fromClipRow(clipRow({ summary: { v: 1 } }))).toBeNull();
    expect(fromClipRow(clipRow({ summary: "{}" }))).toBeNull();
    expect(fromClipRow(clipRow({ played_at: "21/08/2026" }))).toBeNull();
    expect(fromClipRow(clipRow({ played_at: undefined }))).toBeNull();
    expect(fromClipRow(clipRow({ id: undefined }))).toBeNull();
    expect(fromClipRow(clipRow({ player_id: 7 }))).toBeNull();
    expect(fromClipRow(undefined)).toBeNull();
  });
});

describe("validation and dates", () => {
  it("bounds the player name", () => {
    expect(validatePlayerName("Asha")).toBeNull();
    expect(validatePlayerName("  Asha  ")).toBeNull();
    expect(validatePlayerName("a".repeat(PLAYER_NAME_MAX))).toBeNull();
    expect(validatePlayerName("")).not.toBeNull();
    expect(validatePlayerName("   ")).not.toBeNull();
    expect(validatePlayerName("a".repeat(PLAYER_NAME_MAX + 1))).not.toBeNull();
    // Surrounding whitespace does not count against the limit — it is trimmed on save.
    expect(validatePlayerName(`  ${"a".repeat(PLAYER_NAME_MAX)}  `)).toBeNull();
  });

  it("prints and recognises a calendar day", () => {
    expect(isoDay(new Date(2026, 7, 21, 15, 30))).toBe("2026-08-21");
    expect(isoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(isIsoDay("2026-08-21")).toBe(true);
    expect(isIsoDay("2024-02-29")).toBe(true);
    // Well-formed but not a day that exists — the Date would roll it over.
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("2026-8-1")).toBe(false);
    expect(isIsoDay("2026-08-21T00:00:00Z")).toBe(false);
    expect(isIsoDay("")).toBe(false);
  });
});
