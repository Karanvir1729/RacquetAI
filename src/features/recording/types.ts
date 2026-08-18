/**
 * Recording domain types. Pure — no Expo or React Native imports — so unit
 * tests and future features (scoring reads these shapes) can use them without
 * native modules present.
 */

/**
 * Sports a recording can be tagged with. Squash is the beachhead (fixed-camera
 * club courts), but the domain must fit the secondary racquet sports too — the
 * tag is what the scoring phase will branch on.
 */
export const SPORTS = ["squash"] as const;

export type Sport = (typeof SPORTS)[number] | "unspecified";

/**
 * Sidecar JSON schema, version 1. Each video on disk has exactly one sidecar
 * with the same basename (`<id>.json` next to `<id>.mov`), so a recording is
 * self-describing without any central index that could drift from the files.
 */
export interface RecordingMetadata {
  /** Schema version — bump on shape changes; `parseMetadata` rejects unknown versions. */
  v: 1;
  /** Filesystem-safe unique id; also the shared basename of the video + sidecar pair. */
  id: string;
  /** ISO-8601 timestamp of when the recording finished. */
  createdAt: string;
  /** Whole seconds of footage, measured by the capture timer. */
  durationSec: number;
  /** Sport tag; defaults to "unspecified" until the player tags the take. */
  sport: Sport;
  /** Video filename (id + platform extension) so the sidecar alone locates the footage. */
  videoName: string;
}

/** A recording as the Library consumes it: parsed metadata + resolved file facts. */
export interface RecordingEntry {
  meta: RecordingMetadata;
  /** `file://` URI of the video inside the app's documents sandbox. */
  videoUri: string;
  /** Video file size on disk, read live so it never goes stale. */
  sizeBytes: number;
}
