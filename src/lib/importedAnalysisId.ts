/**
 * Ids for analyses imported from the analysis server — pure string logic,
 * unit-tested (the features/recording/naming.ts pattern, which src/lib cannot
 * import — features own their internals, so the ~10 timestamp lines are
 * deliberately duplicated here rather than reaching into a feature).
 *
 * An id looks like `imp-20260816-142312-x7k2` and is the basename of the one
 * file an import leaves on disk: `<id>.analysis.json` in the recordings store.
 * The `imp-` prefix keeps these ids disjoint from recording ids (`rec-…`), so
 * the Library's recording scan can never mistake an imported analysis for a
 * take, and vice versa.
 */

const ID_PATTERN = /^imp-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-z]{4}$/;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const SIDECAR_SUFFIX = ".analysis.json";

const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Mint a new imported-analysis id. `now`/`random` injectable for tests. */
export function makeImportedAnalysisId(
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const date = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`;
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`;
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += BASE36[Math.min(BASE36.length - 1, Math.floor(random() * BASE36.length))];
  }
  return `imp-${date}-${time}-${suffix}`;
}

export function isImportedAnalysisId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/**
 * When the import happened, recovered from the id's UTC timestamp — the id is
 * the only metadata an imported analysis has. Null when the id is not ours.
 */
export function importedAnalysisTimestamp(id: string): Date | null {
  const match = ID_PATTERN.exec(id);
  if (match === null) return null;
  const [, year, month, day, hours, minutes, seconds] = match;
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

/** `imp-…` id → its on-disk sidecar filename. */
export function importedSidecarName(id: string): string {
  return `${id}${SIDECAR_SUFFIX}`;
}

/**
 * Recover the id from a directory-listing filename, or null when the file is
 * not an imported-analysis sidecar — recordings (`rec-….analysis.json`) and
 * stray JSON both fail here, so directory scans can use this as the filter.
 */
export function idFromImportedSidecarName(name: string): string | null {
  if (!name.endsWith(SIDECAR_SUFFIX)) return null;
  const id = name.slice(0, -SIDECAR_SUFFIX.length);
  return isImportedAnalysisId(id) ? id : null;
}
