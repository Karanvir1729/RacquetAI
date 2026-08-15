/**
 * Display formatting helpers. Durations and sizes are rendered ONLY through
 * these functions so a recording's length reads identically in the Library
 * list, the player scrubber, and the export sheet.
 */

/**
 * Seconds → clock string: "0:07", "12:34", "1:02:03".
 * Matches match-video expectations: no zero-padded hours, minutes padded only
 * once an hour is present.
 */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** Bytes → human size: "0 B", "512 B", "1.2 MB", "3.4 GB". One decimal ≥ KB. */
export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safe < 1024) return `${Math.round(safe)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = safe;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}
