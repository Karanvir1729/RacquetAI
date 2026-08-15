import {
  idFromSidecarFileName,
  isRecordingId,
  makeRecordingId,
  normalizeExtension,
  sidecarFileName,
  videoFileName,
} from "../naming";

// 2026-08-15 14:23:12 UTC; fixed rng 0.5 → BASE36[18] = "i" for all 4 chars.
const AT = new Date(Date.UTC(2026, 7, 15, 14, 23, 12));
const fixedRandom = () => 0.5;

describe("makeRecordingId", () => {
  it("encodes the UTC timestamp plus the random suffix", () => {
    expect(makeRecordingId(AT, fixedRandom)).toBe("rec-20260815-142312-iiii");
  });

  it("clamps an rng that returns 1 into the alphabet instead of reading past it", () => {
    expect(makeRecordingId(AT, () => 1)).toBe("rec-20260815-142312-zzzz");
  });

  it("produces valid ids with the real clock and rng", () => {
    expect(isRecordingId(makeRecordingId())).toBe(true);
  });

  it("sorts chronologically as a plain string", () => {
    const earlier = makeRecordingId(AT, fixedRandom);
    const later = makeRecordingId(new Date(AT.getTime() + 60_000), fixedRandom);
    expect(earlier < later).toBe(true);
  });
});

describe("filename scheme", () => {
  const id = "rec-20260815-142312-abcd";

  it("derives the sidecar and video names from the id", () => {
    expect(sidecarFileName(id)).toBe("rec-20260815-142312-abcd.json");
    expect(videoFileName(id, ".mov")).toBe("rec-20260815-142312-abcd.mov");
  });

  it("normalizes a sloppy extension argument", () => {
    expect(videoFileName(id, ".MOV")).toBe(`${id}.mov`);
    expect(videoFileName(id, "")).toBe(`${id}.mp4`);
  });

  it("round-trips id → sidecar name → id", () => {
    const minted = makeRecordingId(AT, fixedRandom);
    expect(idFromSidecarFileName(sidecarFileName(minted))).toBe(minted);
  });

  it("rejects filenames that are not our sidecars", () => {
    expect(idFromSidecarFileName(`${id}.mov`)).toBeNull();
    expect(idFromSidecarFileName("notes.json")).toBeNull();
    expect(idFromSidecarFileName(".json")).toBeNull();
    expect(idFromSidecarFileName("rec-20260815-142312-ABCD.json")).toBeNull();
  });
});

describe("normalizeExtension", () => {
  it("extracts and lowercases the extension from a file uri", () => {
    expect(normalizeExtension("file:///var/cache/Camera/ABC123.MOV")).toBe(".mov");
    expect(normalizeExtension("file:///data/user/0/app/cache/video.mp4")).toBe(".mp4");
  });

  it("ignores query strings and fragments", () => {
    expect(normalizeExtension("file:///cache/take.mov?position=3#t")).toBe(".mov");
  });

  it("falls back to .mp4 when the last segment has no usable extension", () => {
    expect(normalizeExtension("file:///var/cache/video")).toBe(".mp4");
    expect(normalizeExtension("file:///var/cache.dir/video")).toBe(".mp4");
    expect(normalizeExtension("file:///x/video.")).toBe(".mp4");
    expect(normalizeExtension("file:///x/video.toolongext")).toBe(".mp4");
  });
});
