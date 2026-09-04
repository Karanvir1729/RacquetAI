/**
 * The laptop's match history.
 *
 * The phone keeps every take and its analysis in its own documents folder, so
 * closing the app loses nothing. The browser has no such folder: until now an
 * analysis lived only in the tab that ran it, and a refresh threw away a match
 * that took ten minutes of CPU to measure. This is the missing half — the
 * read-out survives the tab.
 *
 * Two deliberate limits, both of them honest:
 *
 * The FOOTAGE is not stored. It never left the visitor's machine to begin
 * with, and a match video is orders of magnitude past anything a browser will
 * hold. A saved analysis therefore opens without video, exactly as rejoining a
 * job by id already does.
 *
 * The POSE TRACK is not stored either. `tracks` is the overwhelming bulk of an
 * analysis file — tens of thousands of samples — and its only consumer is the
 * skeleton drawn over the video, which a saved entry has no video for. Keeping
 * it would buy nothing and would fill the 5MB localStorage budget after two or
 * three matches. Everything a player actually reads — totals, per-player
 * splits, shot list, quality — is kept whole.
 *
 * Storage is split: one small index under INDEX_KEY that the list page reads,
 * and one record per analysis, so opening the library does not deserialize
 * every match ever run. Every entry point is total — a corrupt or absent store
 * reads as "no history" and a full one silently evicts the oldest — because a
 * convenience that can break the analysis it is trying to remember is worse
 * than no convenience at all.
 */
import { parseAnalysisValue, type MatchAnalysis } from "./types";

const INDEX_KEY = "racketiq.history.v1";
const ENTRY_PREFIX = "racketiq.history.v1.entry.";

/** Beyond this the list stops being a history and starts being a haystack. */
const MAX_ENTRIES = 40;

/** What the library list shows without opening anything. */
export interface HistorySummary {
  id: string;
  /** The job this came from, so it can still be quoted in a bug report. */
  jobId: string | null;
  /** The uploaded file's name, or a fallback — this is the row's heading. */
  title: string;
  /** ISO-8601, stamped when the analysis was saved. */
  savedAt: string;
  durationSec: number;
  rallies: number;
  shots: number;
}

function storage(): Storage | null {
  try {
    // Private-mode Safari has thrown on the getter itself, not just on setItem.
    return window.localStorage;
  } catch {
    return null;
  }
}

function readIndex(): HistorySummary[] {
  const store = storage();
  if (store === null) return [];
  try {
    const raw = store.getItem(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSummary);
  } catch {
    return [];
  }
}

function isSummary(value: unknown): value is HistorySummary {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    (typeof item.jobId === "string" || item.jobId === null) &&
    typeof item.title === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.durationSec === "number" &&
    typeof item.rallies === "number" &&
    typeof item.shots === "number"
  );
}

function writeIndex(entries: HistorySummary[]): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    store.setItem(INDEX_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** Newest first — the list a visitor wants is "what did I just run". */
export function listHistory(): HistorySummary[] {
  return readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function loadHistoryEntry(id: string): MatchAnalysis | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(`${ENTRY_PREFIX}${id}`);
    if (raw === null) return null;
    return parseAnalysisValue(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function deleteHistoryEntry(id: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(`${ENTRY_PREFIX}${id}`);
  } catch {
    /* the index entry still goes, which is what the list reads */
  }
  writeIndex(readIndex().filter((entry) => entry.id !== id));
}

export function clearHistory(): void {
  for (const entry of readIndex()) deleteHistoryEntry(entry.id);
  const store = storage();
  try {
    store?.removeItem(INDEX_KEY);
  } catch {
    /* nothing more to do */
  }
}

/** The analysis as it is stored: everything except the pose track. */
function withoutTracks(analysis: MatchAnalysis): Omit<MatchAnalysis, "tracks"> {
  const { tracks: _tracks, ...rest } = analysis;
  return rest;
}

/**
 * Remember one finished analysis. Returns its history id, or null if the
 * browser would not store it (private mode, quota, disabled storage) — callers
 * treat that as "no library today", never as a failed analysis.
 *
 * Saving the same job twice replaces the earlier copy rather than stacking a
 * duplicate: rejoining a job by id is a normal thing to do.
 */
export function saveToHistory(
  analysis: MatchAnalysis,
  { jobId, title, now }: { jobId: string | null; title: string; now: Date },
): string | null {
  const store = storage();
  if (store === null) return null;

  const existing = readIndex();
  const priorForJob = jobId === null ? undefined : existing.find((e) => e.jobId === jobId);
  const id = priorForJob?.id ?? `${now.getTime().toString(36)}-${existing.length.toString(36)}`;

  const summary: HistorySummary = {
    id,
    jobId,
    title: title.trim().length > 0 ? title.trim() : "Match analysis",
    savedAt: now.toISOString(),
    durationSec: analysis.video.durationSec,
    rallies: analysis.rallies.count,
    shots: analysis.shots.length,
  };

  const body = JSON.stringify(withoutTracks(analysis));

  // Oldest-first, so eviction takes from the front. The entry being written is
  // never a candidate — replacing your own match with itself would loop.
  let others = existing
    .filter((entry) => entry.id !== id)
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));

  while (others.length >= MAX_ENTRIES) {
    const oldest = others[0];
    if (oldest === undefined) break;
    deleteHistoryEntry(oldest.id);
    others = others.slice(1);
  }

  for (;;) {
    try {
      store.setItem(`${ENTRY_PREFIX}${id}`, body);
      break;
    } catch {
      // Quota. Drop the oldest match and try again; if there is nothing left to
      // drop, this browser simply cannot hold an analysis and we say so by
      // returning null rather than leaving a row pointing at no record.
      const oldest = others[0];
      if (oldest === undefined) {
        // `others` is what survived eviction, so this drops the row for `id`
        // without resurrecting the records we just deleted.
        writeIndex(others);
        return null;
      }
      deleteHistoryEntry(oldest.id);
      others = others.slice(1);
    }
  }

  if (!writeIndex([...others, summary])) {
    try {
      store.removeItem(`${ENTRY_PREFIX}${id}`);
    } catch {
      /* best effort */
    }
    return null;
  }
  return id;
}
