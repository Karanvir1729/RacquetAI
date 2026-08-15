import { parseMetadata, serializeMetadata } from "../metadata";
import type { RecordingMetadata } from "../types";

const VALID: RecordingMetadata = {
  v: 1,
  id: "rec-20260815-142312-abcd",
  createdAt: "2026-08-15T14:23:12.000Z",
  durationSec: 754,
  sport: "squash",
  videoName: "rec-20260815-142312-abcd.mov",
};

describe("sidecar round-trip", () => {
  it("serialize → parse yields the identical metadata", () => {
    expect(parseMetadata(serializeMetadata(VALID))).toEqual(VALID);
  });

  it("round-trips every declared sport and the unspecified default", () => {
    for (const sport of ["squash", "tennis", "pickleball", "badminton", "unspecified"] as const) {
      const meta = { ...VALID, sport };
      expect(parseMetadata(serializeMetadata(meta))?.sport).toBe(sport);
    }
  });

  it("ignores unknown extra fields from a future writer", () => {
    const withExtra = JSON.stringify({ ...VALID, futureField: "ignore me" });
    expect(parseMetadata(withExtra)).toEqual(VALID);
  });
});

describe("parseMetadata validation", () => {
  it("rejects non-JSON and non-object payloads", () => {
    expect(parseMetadata("not json {")).toBeNull();
    expect(parseMetadata("42")).toBeNull();
    expect(parseMetadata("null")).toBeNull();
    expect(parseMetadata("[]")).toBeNull();
  });

  it("rejects unknown schema versions rather than misreading them", () => {
    expect(parseMetadata(JSON.stringify({ ...VALID, v: 2 }))).toBeNull();
    const withoutVersion: Record<string, unknown> = { ...VALID };
    delete withoutVersion.v;
    expect(parseMetadata(JSON.stringify(withoutVersion))).toBeNull();
  });

  it("rejects a missing or malformed id", () => {
    expect(parseMetadata(JSON.stringify({ ...VALID, id: undefined }))).toBeNull();
    expect(parseMetadata(JSON.stringify({ ...VALID, id: "../../etc/passwd" }))).toBeNull();
  });

  it("rejects an unparseable createdAt and a missing videoName", () => {
    expect(parseMetadata(JSON.stringify({ ...VALID, createdAt: "not a date" }))).toBeNull();
    expect(parseMetadata(JSON.stringify({ ...VALID, videoName: "" }))).toBeNull();
  });

  it("rejects a non-numeric duration and clamps a negative one to zero", () => {
    expect(parseMetadata(JSON.stringify({ ...VALID, durationSec: "12" }))).toBeNull();
    expect(parseMetadata(JSON.stringify({ ...VALID, durationSec: Number.NaN }))).toBeNull();
    expect(parseMetadata(JSON.stringify({ ...VALID, durationSec: -3 }))?.durationSec).toBe(0);
  });

  it("coerces an unknown sport to unspecified instead of dropping the recording", () => {
    expect(parseMetadata(JSON.stringify({ ...VALID, sport: "cricket" }))?.sport).toBe(
      "unspecified",
    );
    expect(parseMetadata(JSON.stringify({ ...VALID, sport: 7 }))?.sport).toBe("unspecified");
  });
});
