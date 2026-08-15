/**
 * Sidecar (de)serialization — pure, unit-tested. Parsing is defensive: a
 * sidecar comes off disk, so every field is narrowed from `unknown` and a
 * corrupt file yields `null` (the caller skips it) instead of a crash that
 * would take the whole Library down with it.
 */
import { isRecordingId } from "./naming";
import { SPORTS, type RecordingMetadata, type Sport } from "./types";

export function serializeMetadata(meta: RecordingMetadata): string {
  // Pretty-printed on purpose: sidecars are the app's only "database" and
  // being able to eyeball one in a file browser is worth the few bytes.
  return JSON.stringify(meta, null, 2);
}

/** Unknown sport strings degrade to "unspecified" rather than invalidating the file. */
function asSport(value: unknown): Sport {
  return typeof value === "string" && (SPORTS as readonly string[]).includes(value)
    ? (value as Sport)
    : "unspecified";
}

export function parseMetadata(raw: string): RecordingMetadata | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;

  // Only schema v1 is readable; a future v2 file is skipped, not misread.
  if (record.v !== 1) return null;
  if (typeof record.id !== "string" || !isRecordingId(record.id)) return null;
  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    return null;
  }
  if (typeof record.videoName !== "string" || record.videoName.length === 0) return null;
  if (typeof record.durationSec !== "number" || !Number.isFinite(record.durationSec)) return null;

  return {
    v: 1,
    id: record.id,
    createdAt: record.createdAt,
    durationSec: Math.max(0, record.durationSec),
    sport: asSport(record.sport),
    videoName: record.videoName,
  };
}
