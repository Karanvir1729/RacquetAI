/**
 * On-disk recording store, built on the expo-file-system object API.
 *
 * Layout: `<documents>/recordings/<id>.<ext>` + `<id>.json` sidecar (schema in
 * types.ts). The analysis pipeline may add a third file per take,
 * `<id>.analysis.json` (read via src/lib/analysisSidecar — the directory
 * location itself is promoted to src/lib/recordingsDir so features/analysis
 * can share it). The documents directory is the sandbox location iOS never
 * purges, unlike the cache directory expo-camera records into. There is no
 * central index — the directory listing IS the database — so the store can
 * never disagree with the files that actually exist.
 *
 * Everything here is synchronous on purpose: the new FileSystem API is
 * sync-first, sidecars are a few hundred bytes, and moving the finished video
 * out of the camera cache is a same-volume rename, not a copy. Callers wrap
 * calls in try/catch — disk errors throw.
 */
import { File, type Directory } from "expo-file-system";

import { recordingsDirectory } from "@/lib/recordingsDir";

import { parseMetadata, serializeMetadata } from "./metadata";
import {
  idFromSidecarFileName,
  makeRecordingId,
  normalizeExtension,
  sidecarFileName,
  videoFileName,
} from "./naming";
import type { RecordingEntry, RecordingMetadata, Sport } from "./types";

function ensureDirectory(): Directory {
  const dir = recordingsDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export interface SaveRecordingInput {
  /** The temporary `file://` URI the camera resolved recordAsync with. */
  sourceUri: string;
  /** Elapsed capture time in seconds (fractional ok — rounded for the sidecar). */
  durationSec: number;
  sport?: Sport;
  /** Injectable clock for tests. */
  now?: Date;
}

/** Move a finished take from the camera cache into the store and write its sidecar. */
export function saveRecording({
  sourceUri,
  durationSec,
  sport = "unspecified",
  now = new Date(),
}: SaveRecordingInput): RecordingEntry {
  const dir = ensureDirectory();
  const id = makeRecordingId(now);
  const videoName = videoFileName(id, normalizeExtension(sourceUri));
  const video = new File(dir, videoName);
  new File(sourceUri).moveSync(video);

  const meta: RecordingMetadata = {
    v: 1,
    id,
    createdAt: now.toISOString(),
    durationSec: Math.max(0, Math.round(durationSec)),
    sport,
    videoName,
  };
  const sidecar = new File(dir, sidecarFileName(id));
  if (!sidecar.exists) sidecar.create();
  sidecar.write(serializeMetadata(meta));
  return { meta, videoUri: video.uri, sizeBytes: video.size };
}

/**
 * All recordings, newest first. Scans for valid sidecars and skips anything
 * broken (corrupt JSON, missing video file) instead of failing the whole list
 * — one bad file must not blank the Library.
 */
export function listRecordings(): RecordingEntry[] {
  const dir = recordingsDirectory();
  if (!dir.exists) return [];

  const entries: RecordingEntry[] = [];
  for (const item of dir.list()) {
    if (!(item instanceof File) || idFromSidecarFileName(item.name) === null) continue;
    const meta = parseMetadata(item.textSync());
    if (meta === null) continue;
    const video = new File(dir, meta.videoName);
    if (!video.exists) continue; // orphan sidecar — nothing to play
    entries.push({ meta, videoUri: video.uri, sizeBytes: video.size });
  }
  return entries.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
}

/**
 * Delete a recording's video AND sidecar. Prefix-matched against the directory
 * listing (not read from the sidecar) so a recording with a corrupt sidecar
 * can still be fully removed.
 */
export function deleteRecording(id: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) return;
  for (const item of dir.list()) {
    if (item instanceof File && item.name.startsWith(`${id}.`)) item.delete();
  }
}
