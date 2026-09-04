import { SHOT_TYPES } from "../../analysis/types";
import { basisLabel, formatIsoDay, recordingsWord, shotTypeCounts } from "../display";
import type { ShotTypeCounts } from "../shape";

function counts(partial: Partial<ShotTypeCounts>): ShotTypeCounts {
  const all = {} as ShotTypeCounts;
  for (const type of SHOT_TYPES) all[type] = partial[type] ?? 0;
  return all;
}

describe("formatIsoDay", () => {
  it("renders YYYY-MM-DD as day month year", () => {
    expect(formatIsoDay("2026-08-21")).toBe("21 Aug 2026");
    expect(formatIsoDay("2025-01-05")).toBe("5 Jan 2025");
  });

  it("passes anything else through untouched", () => {
    expect(formatIsoDay("")).toBe("");
    expect(formatIsoDay("21/08/2026")).toBe("21/08/2026");
    expect(formatIsoDay("2026-13-01")).toBe("2026-13-01");
  });
});

describe("recordingsWord", () => {
  it("pluralises", () => {
    expect(recordingsWord(1)).toBe("1 recording");
    expect(recordingsWord(0)).toBe("0 recordings");
    expect(recordingsWord(4)).toBe("4 recordings");
  });
});

describe("basisLabel", () => {
  it("says what a note rests on, and marks classes as indicative", () => {
    expect(basisLabel("position")).toBe("From position & timing");
    expect(basisLabel("classes")).toBe("From shot classes · indicative");
  });
});

describe("shotTypeCounts", () => {
  it("ranks by frequency with unknown last and contract order on ties", () => {
    const ranked = shotTypeCounts(counts({ drive: 5, drop: 2, unknown: 9, volley: 2, boast: 0 }));
    expect(ranked.map((item) => item.type)).toEqual(["drive", "drop", "volley", "unknown"]);
  });

  it("is empty when nothing was classified", () => {
    expect(shotTypeCounts(counts({}))).toEqual([]);
  });
});
