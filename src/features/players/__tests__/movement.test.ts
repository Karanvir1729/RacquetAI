/**
 * Court movement across recordings — read off the per-clip coverage maps.
 * The geometry is the contract's (row 0 = front wall), so a map lit only in
 * its first rows must read as "front", and a map lit in its last columns as
 * "right"; shares must sum to one per axis; spread counts cells at or above
 * a tenth of the peak; pooling is time-weighted; clips with no map are
 * counted, not dropped silently.
 */
import { DEMO_ANALYSIS } from "../../analysis/demoAnalysis";
import { clipsOnDay, movementProfile, regionShares, SPREAD_THRESHOLD } from "../aggregate";
import { summarizeClip, type ClipSummary, type PlayerClip } from "../shape";

function map(rows: number, cols: number, fill: (row: number, col: number) => number) {
  const values: number[] = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) values.push(fill(row, col));
  return { rows, cols, values };
}

function clipWith(summary: ClipSummary, overrides: Partial<PlayerClip> = {}): PlayerClip {
  return {
    id: "c",
    playerId: "p",
    side: "A",
    title: "Clip",
    jobId: null,
    historyId: null,
    playedAt: "2026-08-01",
    durationSec: summary.durationSec,
    shots: summary.me.shots,
    summary,
    posterPath: null,
    analysisPath: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

const BASE = summarizeClip(DEMO_ANALYSIS, "A");
if (BASE === null) throw new Error("demo analysis has no side A");

describe("regionShares", () => {
  it("reads a front-only map as front, and a right-only map as right", () => {
    const front = regionShares(map(12, 8, (row) => (row < 4 ? 1 : 0)));
    expect(front?.front).toBeCloseTo(1, 6);
    expect(front?.middle).toBeCloseTo(0, 6);
    expect(front?.back).toBeCloseTo(0, 6);
    const right = regionShares(map(12, 8, (_row, col) => (col >= 5 ? 1 : 0)));
    expect(right?.right).toBeCloseTo(1, 6);
    expect(right?.left).toBeCloseTo(0, 6);
    expect(right?.centre).toBeCloseTo(0, 6);
  });

  it("splits the standard 8 columns 3-2-3 and shares sum to one per axis", () => {
    const shares = regionShares(map(12, 8, () => 1));
    expect(shares).not.toBeNull();
    expect(shares!.left).toBeCloseTo(3 / 8, 6);
    expect(shares!.centre).toBeCloseTo(2 / 8, 6);
    expect(shares!.right).toBeCloseTo(3 / 8, 6);
    expect(shares!.front + shares!.middle + shares!.back).toBeCloseTo(1, 6);
    expect(shares!.left + shares!.centre + shares!.right).toBeCloseTo(1, 6);
    expect(shares!.spread).toBeCloseTo(1, 6);
  });

  it("counts spread as the cells at or above a tenth of the peak", () => {
    const shares = regionShares(map(2, 2, (row, col) => (row === 0 && col === 0 ? 1 : SPREAD_THRESHOLD / 2)));
    expect(shares?.spread).toBeCloseTo(1 / 4, 6);
    const edge = regionShares(map(1, 2, (_row, col) => (col === 0 ? 1 : SPREAD_THRESHOLD)));
    expect(edge?.spread).toBeCloseTo(1, 6);
  });

  it("is null for an empty map", () => {
    expect(regionShares(map(3, 3, () => 0))).toBeNull();
    expect(regionShares({ rows: 0, cols: 0, values: [] })).toBeNull();
  });
});

describe("movementProfile", () => {
  it("pools time-weighted, keeps chronology, and counts clips without a map", () => {
    const a = clipWith(
      { ...BASE, durationSec: 100, me: { ...BASE.me, coverage: map(12, 8, (row) => (row < 4 ? 1 : 0)) } },
      { id: "a", playedAt: "2026-07-01" },
    );
    const b = clipWith(
      { ...BASE, durationSec: 300, me: { ...BASE.me, coverage: map(12, 8, (row) => (row >= 8 ? 1 : 0)) } },
      { id: "b", playedAt: "2026-06-01" },
    );
    const none = clipWith({ ...BASE, me: { ...BASE.me, coverage: null } }, { id: "n", playedAt: "2026-05-01" });
    const profile = movementProfile([a, none, b]);
    expect(profile.points.map((point) => point.clipId)).toEqual(["b", "a"]);
    expect(profile.clipsWithoutCoverage).toBe(1);
    // 300s of "back" and 100s of "front" → 75% back, 25% front.
    expect(profile.pooled?.back).toBeCloseTo(0.75, 6);
    expect(profile.pooled?.front).toBeCloseTo(0.25, 6);
    expect(profile.pooled?.middle).toBeCloseTo(0, 6);
  });

  it("is empty, not broken, with no clips or no maps", () => {
    expect(movementProfile([])).toEqual({ points: [], pooled: null, clipsWithoutCoverage: 0 });
    const none = clipWith({ ...BASE, me: { ...BASE.me, coverage: null } });
    expect(movementProfile([none])).toEqual({ points: [], pooled: null, clipsWithoutCoverage: 1 });
  });

  it("reads the app's own demo analysis", () => {
    const profile = movementProfile([clipWith(BASE)]);
    expect(profile.points).toHaveLength(1);
    const point = profile.points[0]!;
    expect(point.front + point.middle + point.back).toBeCloseTo(1, 6);
    expect(point.spread).toBeGreaterThan(0);
    expect(point.spread).toBeLessThanOrEqual(1);
  });
});

describe("clipsOnDay", () => {
  it("returns that day's clips in tag order and nothing else", () => {
    const one = clipWith(BASE, { id: "1", playedAt: "2026-08-13", createdAt: "2026-08-13T10:00:00.000Z" });
    const two = clipWith(BASE, { id: "2", playedAt: "2026-08-13", createdAt: "2026-08-13T09:00:00.000Z" });
    const other = clipWith(BASE, { id: "3", playedAt: "2026-08-14" });
    expect(clipsOnDay([one, other, two], "2026-08-13").map((clip) => clip.id)).toEqual(["2", "1"]);
    expect(clipsOnDay([one, other, two], "2026-01-01")).toEqual([]);
  });
});
