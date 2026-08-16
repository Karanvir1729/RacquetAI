import { DEMO_ANALYSIS } from "../demoAnalysis";
import { parseAnalysis } from "../types";

/** Stringify with shallow top-level overrides — mirrors the metadata.test.ts style. */
const raw = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...DEMO_ANALYSIS, ...overrides });

/** The demo's first player with shallow overrides, keeping the second player valid. */
const rawWithPlayerA = (overrides: Record<string, unknown>) =>
  raw({ players: [{ ...DEMO_ANALYSIS.players[0], ...overrides }, DEMO_ANALYSIS.players[1]] });

describe("parseAnalysis round-trip", () => {
  it("parses the demo analysis back to an identical object", () => {
    expect(parseAnalysis(JSON.stringify(DEMO_ANALYSIS))).toEqual(DEMO_ANALYSIS);
  });

  it("ignores unknown extra fields from a future writer", () => {
    expect(parseAnalysis(raw({ futureField: "ignore me" }))).toEqual(DEMO_ANALYSIS);
  });
});

describe("parseAnalysis structural rejection", () => {
  it("rejects non-JSON and non-object payloads", () => {
    expect(parseAnalysis("not json {")).toBeNull();
    expect(parseAnalysis("42")).toBeNull();
    expect(parseAnalysis("null")).toBeNull();
    expect(parseAnalysis("[]")).toBeNull();
  });

  it("rejects unknown schema versions rather than misreading them", () => {
    expect(parseAnalysis(raw({ schemaVersion: 2 }))).toBeNull();
    expect(parseAnalysis(raw({ schemaVersion: undefined }))).toBeNull();
  });

  it("rejects a malformed video block", () => {
    expect(parseAnalysis(raw({ video: { ...DEMO_ANALYSIS.video, fps: "30" } }))).toBeNull();
    expect(parseAnalysis(raw({ video: undefined }))).toBeNull();
  });

  it("rejects an empty or missing players array", () => {
    expect(parseAnalysis(raw({ players: [] }))).toBeNull();
    expect(parseAnalysis(raw({ players: undefined }))).toBeNull();
  });

  it("rejects a player with an unknown id", () => {
    expect(parseAnalysis(rawWithPlayerA({ id: "C" }))).toBeNull();
  });

  it("rejects a player missing a placement quadrant", () => {
    const placement: Record<string, unknown> = { ...DEMO_ANALYSIS.players[0].placement };
    delete placement.backLeft;
    expect(parseAnalysis(rawWithPlayerA({ placement }))).toBeNull();
  });

  it("rejects a heatmap whose values length disagrees with rows x cols", () => {
    const heatmap = DEMO_ANALYSIS.players[0].coverageHeatmap;
    expect(
      parseAnalysis(rawWithPlayerA({ coverageHeatmap: { ...heatmap, values: heatmap.values.slice(1) } })),
    ).toBeNull();
  });

  it("rejects a heatmap containing a non-numeric value", () => {
    const heatmap = DEMO_ANALYSIS.players[0].coverageHeatmap;
    const values: unknown[] = [...heatmap.values];
    values[0] = "high";
    expect(parseAnalysis(rawWithPlayerA({ coverageHeatmap: { ...heatmap, values } }))).toBeNull();
  });

  it("rejects non-finite rally stats", () => {
    expect(parseAnalysis(raw({ rallies: { ...DEMO_ANALYSIS.rallies, count: "41" } }))).toBeNull();
  });

  it("rejects a non-boolean audioAvailable flag", () => {
    expect(
      parseAnalysis(raw({ quality: { ...DEMO_ANALYSIS.quality, audioAvailable: "no" } })),
    ).toBeNull();
  });
});

describe("parseAnalysis clamping and degradation", () => {
  it("clamps out-of-range heatmap values into 0..1", () => {
    const heatmap = DEMO_ANALYSIS.players[0].coverageHeatmap;
    const values = [...heatmap.values];
    values[0] = 1.4;
    values[1] = -0.2;
    const parsed = parseAnalysis(rawWithPlayerA({ coverageHeatmap: { ...heatmap, values } }));
    expect(parsed?.players[0].coverageHeatmap.values[0]).toBe(1);
    expect(parsed?.players[0].coverageHeatmap.values[1]).toBe(0);
  });

  it("clamps tTimePct and the predictability score into range", () => {
    const parsed = parseAnalysis(
      rawWithPlayerA({
        tTimePct: 104.2,
        predictability: { ...DEMO_ANALYSIS.players[0].predictability, score: 1.2 },
      }),
    );
    expect(parsed?.players[0].tTimePct).toBe(100);
    expect(parsed?.players[0].predictability.score).toBe(1);
  });

  it("degrades a missing player label to the player id", () => {
    const parsed = parseAnalysis(rawWithPlayerA({ label: "" }));
    expect(parsed?.players[0].label).toBe("Player A");
  });

  it("drops malformed shot events but keeps the valid ones", () => {
    const parsed = parseAnalysis(
      raw({
        shots: [
          { tSec: 12.4, player: "A", cell: "backLeft" },
          { tSec: "later", player: "A", cell: "backLeft" },
          { tSec: 14.1, player: "Z", cell: "backLeft" },
          { tSec: 15.9, player: "B", cell: "midCourt" },
          7,
        ],
      }),
    );
    expect(parsed?.shots).toEqual([{ tSec: 12.4, player: "A", cell: "backLeft" }]);
  });

  it("keeps only string notes and treats a non-array as empty", () => {
    const quality = DEMO_ANALYSIS.quality;
    expect(
      parseAnalysis(raw({ quality: { ...quality, notes: ["kept", 7, null] } }))?.quality.notes,
    ).toEqual(["kept"]);
    expect(
      parseAnalysis(raw({ quality: { ...quality, notes: "not an array" } }))?.quality.notes,
    ).toEqual([]);
  });
});
