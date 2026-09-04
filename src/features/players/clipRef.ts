/**
 * What a read-out on the phone IS, for tagging — the `ClipRef` the tag
 * control hands the store. Pure, unit-tested.
 *
 * The phone's own id is the durable handle. A recording is `rec-…` and an
 * import is `imp-…`, both the basename of the sidecar on disk and both
 * carrying the UTC instant they were made (features/recording/naming.ts,
 * src/lib/importedAnalysisId.ts). That id plays the role the web's library
 * id plays — `historyId` — so the store finds a clip's existing tags the
 * same way on both clients.
 *
 * `jobId` is null on the phone, and honestly so: the import flow's server
 * job id lives only in flow state while the upload runs (useImportFlow) and
 * is never written to disk, so a reopened read-out has no job id to offer.
 * The web stores it because its library keeps it; a tag made here is keyed by
 * the phone's id alone, and the store treats the two keys as alternatives.
 *
 * The "played on" default is the day the recording or import was made, read
 * off the id — `saveRecording` mints the id and the sidecar's `createdAt` from
 * the same `now`, so this is the sidecar's timestamp without a disk read —
 * and falls back to today for any id that carries no timestamp. Local
 * calendar day, as `isoDay` renders it: the calendar is the tagger's.
 */
import { isoDay, type ClipRef } from "./shape";

/** `rec-20260815-142312-x7k2` / `imp-…`: the same UTC stamp both id schemes carry. */
const TIMESTAMPED_ID = /^(rec|imp)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-z]{4}$/;

/** The instant a recording or import was made, from its id; null for any other id. */
export function recordingInstant(id: string): Date | null {
  const match = TIMESTAMPED_ID.exec(id);
  if (match === null) return null;
  const [, , year, month, day, hours, minutes, seconds] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The clip reference for the recording the analysis screen is showing.
 * `today` is injectable for tests; production callers use the default.
 */
export function clipRefForRecording(recordingId: string, today: Date = new Date()): ClipRef {
  const made = recordingInstant(recordingId);
  return {
    jobId: null,
    historyId: recordingId,
    // Recordings carry no title of their own on the phone (the Library names
    // them by date), so the clip is titled the way the screen that showed it
    // is — and an import says it was one, as the Library's own row does.
    title: recordingId.startsWith("imp-") ? "Imported analysis" : "Match analysis",
    playedAt: isoDay(made ?? today),
  };
}
