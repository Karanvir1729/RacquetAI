import {
  idFromImportedSidecarName,
  importedAnalysisTimestamp,
  importedSidecarName,
  isImportedAnalysisId,
  makeImportedAnalysisId,
} from "../importedAnalysisId";

// 2026-08-16 09:05:07 UTC; fixed rng 0.5 → BASE36[18] = "i" for all 4 chars.
const AT = new Date(Date.UTC(2026, 7, 16, 9, 5, 7));
const fixedRandom = () => 0.5;

describe("makeImportedAnalysisId", () => {
  it("encodes the UTC timestamp plus the random suffix", () => {
    expect(makeImportedAnalysisId(AT, fixedRandom)).toBe("imp-20260816-090507-iiii");
  });

  it("clamps an rng that returns 1 into the alphabet instead of reading past it", () => {
    expect(makeImportedAnalysisId(AT, () => 1)).toBe("imp-20260816-090507-zzzz");
  });

  it("produces valid ids with the real clock and rng", () => {
    expect(isImportedAnalysisId(makeImportedAnalysisId())).toBe(true);
  });
});

describe("isImportedAnalysisId", () => {
  it("accepts its own ids and rejects recording ids and noise", () => {
    expect(isImportedAnalysisId("imp-20260816-090507-iiii")).toBe(true);
    expect(isImportedAnalysisId("rec-20260816-090507-iiii")).toBe(false);
    expect(isImportedAnalysisId("imp-20260816-090507")).toBe(false);
    expect(isImportedAnalysisId("imp-20260816-090507-IIII")).toBe(false);
    expect(isImportedAnalysisId("")).toBe(false);
  });
});

describe("importedAnalysisTimestamp", () => {
  it("round-trips the mint time through the id", () => {
    const id = makeImportedAnalysisId(AT, fixedRandom);
    expect(importedAnalysisTimestamp(id)?.getTime()).toBe(AT.getTime());
  });

  it("returns null for foreign ids", () => {
    expect(importedAnalysisTimestamp("rec-20260816-090507-iiii")).toBeNull();
    expect(importedAnalysisTimestamp("not an id")).toBeNull();
  });
});

describe("sidecar filename scheme", () => {
  const id = "imp-20260816-090507-abcd";

  it("round-trips id → filename → id", () => {
    expect(importedSidecarName(id)).toBe("imp-20260816-090507-abcd.analysis.json");
    expect(idFromImportedSidecarName(importedSidecarName(id))).toBe(id);
  });

  it("rejects recording files so directory scans stay disjoint", () => {
    // A recording's metadata sidecar and the pipeline's analysis sidecar.
    expect(idFromImportedSidecarName("rec-20260816-090507-abcd.json")).toBeNull();
    expect(idFromImportedSidecarName("rec-20260816-090507-abcd.analysis.json")).toBeNull();
  });

  it("rejects near-misses and strays", () => {
    expect(idFromImportedSidecarName("imp-20260816-090507-abcd.json")).toBeNull();
    expect(idFromImportedSidecarName("imp-20260816-090507-abcd.mov")).toBeNull();
    expect(idFromImportedSidecarName("notes.analysis.json")).toBeNull();
  });
});
