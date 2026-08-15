/**
 * The recording id + filename scheme — pure string logic, unit-tested.
 *
 * An id looks like `rec-20260815-142312-x7k2`: a UTC timestamp for humans
 * (files sort chronologically in any file browser) plus a random base36
 * suffix so two recordings finishing within the same second never collide.
 * The id is the shared basename of the pair on disk: `<id>.mov` + `<id>.json`.
 */

const ID_PATTERN = /^rec-\d{8}-\d{6}-[0-9a-z]{4}$/;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Extension shape we trust in a filename: dot + 2-5 alphanumerics. */
const EXTENSION_PATTERN = /^\.[a-z0-9]{2,5}$/;
/** What the camera actually emits when we can't tell (Android records mp4). */
const FALLBACK_EXTENSION = ".mp4";

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/**
 * Mint a new recording id. `now` and `random` are injectable so tests are
 * deterministic; production callers use the defaults.
 */
export function makeRecordingId(
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const date = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`;
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`;
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += BASE36[Math.min(BASE36.length - 1, Math.floor(random() * BASE36.length))];
  }
  return `rec-${date}-${time}-${suffix}`;
}

export function isRecordingId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function sidecarFileName(id: string): string {
  return `${id}.json`;
}

export function videoFileName(id: string, extension: string): string {
  return `${id}${normalizeExtension(extension)}`;
}

/**
 * Recover the id from a sidecar filename, or null when the file is not one of
 * ours — directory scans use this as the filter, so a stray `notes.json`
 * dropped into the folder can never surface as a recording.
 */
export function idFromSidecarFileName(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -".json".length);
  return isRecordingId(id) ? id : null;
}

/**
 * Extract a safe lowercase extension (".mov") from a URI, path, or bare
 * extension. Anything unusable — no dot in the final path segment, a trailing
 * dot, a dot only in a parent folder — falls back to ".mp4".
 */
export function normalizeExtension(source: string): string {
  const withoutQuery = source.split("?")[0].split("#")[0];
  const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  if (dot < 0) return FALLBACK_EXTENSION;
  const extension = lastSegment.slice(dot).toLowerCase();
  return EXTENSION_PATTERN.test(extension) ? extension : FALLBACK_EXTENSION;
}
