/**
 * The app's own analysis contract drives the shared profile domain. The web
 * suites (web/src/players/__tests__) exercise the same modules over pipeline
 * fixtures through the web's type mirror; this one feeds the APP's bundled
 * analysis — typed by src/features/analysis/types.ts, the authoritative
 * schema — through summarise → store-shaped JSON → parse → aggregate, which
 * is exactly the path a tag made on the phone takes.
 */
import { DEMO_ANALYSIS } from "../../analysis/demoAnalysis";
import { buildProfileStats, calendarWeeks, scoutingNotes } from "../aggregate";
import {
  CLIP_SUMMARY_VERSION,
  parseClipSummary,
  summarizeClip,
  type ClipSummary,
  type PlayerClip,
} from "../shape";

function clipFrom(summary: ClipSummary, overrides: Partial<PlayerClip> = {}): PlayerClip {
  return {
    id: "clip-1",
    playerId: "player-1",
    side: "A",
    title: "Match analysis",
    jobId: null,
    historyId: "rec-20260815-142312-x7k2",
    playedAt: "2026-08-15",
    durationSec: summary.durationSec,
    shots: summary.me.shots,
    summary,
    createdAt: "2026-08-15T14:30:00.000Z",
    ...overrides,
  };
}

describe("summarizeClip over the app's bundled analysis", () => {
  const playerA = DEMO_ANALYSIS.players.find((p) => p.id === "A");
  const playerB = DEMO_ANALYSIS.players.find((p) => p.id === "B");

  it("keeps the tagged side's numbers and the opponent's for comparison", () => {
    const summary = summarizeClip(DEMO_ANALYSIS, "A");
    expect(summary).not.toBeNull();
    expect(playerA).toBeDefined();
    if (summary === null || playerA === undefined) return;
    expect(summary.v).toBe(CLIP_SUMMARY_VERSION);
    expect(summary.schemaVersion).toBe(DEMO_ANALYSIS.schemaVersion);
    expect(summary.durationSec).toBe(DEMO_ANALYSIS.video.durationSec);
    expect(summary.me.label).toBe(playerA.label);
    expect(summary.me.shots).toBe(playerA.shots);
    expect(summary.me.placement).toEqual(playerA.placement);
    expect(summary.me.tTimePct).toBe(playerA.tTimePct);
    expect(summary.me.coverage).toEqual(playerA.coverageHeatmap);
    expect(summary.me.predictability).toEqual(playerA.predictability);
    // The opponent travels without a heatmap — nothing on a profile reads it.
    expect(summary.opponent?.label).toBe(playerB?.label);
    expect(summary.opponent?.coverage).toBeNull();
  });

  it("round-trips through the stored-row parser byte for byte", () => {
    const summary = summarizeClip(DEMO_ANALYSIS, "A");
    expect(summary).not.toBeNull();
    if (summary === null) return;
    // A Supabase jsonb column is exactly this: serialised, then read back.
    const stored: unknown = JSON.parse(JSON.stringify(summary));
    expect(parseClipSummary(stored)).toEqual(summary);
  });

  it("counts the other side's shots too, so either tag works", () => {
    const summary = summarizeClip(DEMO_ANALYSIS, "B");
    expect(summary?.me.shots).toBe(playerB?.shots);
    expect(summary?.opponent?.shots).toBe(playerA?.shots);
  });
});

describe("buildProfileStats over one app clip", () => {
  const summary = summarizeClip(DEMO_ANALYSIS, "A");
  const playerA = DEMO_ANALYSIS.players.find((p) => p.id === "A");

  it("reports one recording and the read-out's own numbers", () => {
    expect(summary).not.toBeNull();
    expect(playerA).toBeDefined();
    if (summary === null || playerA === undefined) return;
    const stats = buildProfileStats([clipFrom(summary)]);
    expect(stats.recordings).toBe(1);
    expect(stats.totalSec).toBe(DEMO_ANALYSIS.video.durationSec);
    expect(stats.totalShots).toBe(playerA.shots);
    expect(stats.totalRallies).toBe(DEMO_ANALYSIS.rallies.count);
    expect(stats.longestRally).toBe(DEMO_ANALYSIS.rallies.longestRally);
    expect(stats.firstPlayedAt).toBe("2026-08-15");
    expect(stats.lastPlayedAt).toBe("2026-08-15");
    // One clip: time-weighting is a no-op, so the pooled figures ARE the clip's.
    expect(stats.tTimePct).toBeCloseTo(playerA.tTimePct, 6);
    expect(stats.placement).toEqual(playerA.placement);
    expect(stats.coverage?.rows).toBe(playerA.coverageHeatmap.rows);
    expect(stats.coverage?.cols).toBe(playerA.coverageHeatmap.cols);
    expect(stats.trend).toHaveLength(1);
    expect(stats.versus.clips).toBe(1);
  });

  it("derives the calendar and notes from the same clip without throwing", () => {
    expect(summary).not.toBeNull();
    if (summary === null) return;
    const clip = clipFrom(summary);
    const calendar = calendarWeeks([clip], new Date(2026, 7, 21));
    expect(calendar.inWindow).toBe(1);
    expect(calendar.max).toBe(1);
    const lit = calendar.weeks.flat().filter((day) => day.count > 0);
    expect(lit).toHaveLength(1);
    expect(lit[0]?.date).toBe("2026-08-15");
    expect(lit[0]?.level).toBe(4);
    // Notes are rule-based sentences; over a real clip they must simply be
    // well-formed, each carrying the basis chip the product promises.
    for (const note of scoutingNotes(buildProfileStats([clip]))) {
      expect(note.title.length).toBeGreaterThan(0);
      expect(note.detail.length).toBeGreaterThan(0);
      expect(["position", "classes"]).toContain(note.basis);
    }
  });
});
