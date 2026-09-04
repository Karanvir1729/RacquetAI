/**
 * The one-item handoff between /record and /analyze.
 *
 * A recording is a Blob in memory. It cannot go through the URL, and putting
 * it in history state would ask the browser to structured-clone hundreds of
 * megabytes on every back button. A module-scope slot, handed over once and
 * cleared on read, is the whole mechanism — and clearing on read is what stops
 * a stale take from being re-analysed the next time someone opens /analyze.
 */
let pending: File | null = null;

export function handOffForAnalysis(file: File): void {
  pending = file;
}

/** Take the pending recording, if there is one. Reading it clears the slot. */
export function takePendingUpload(): File | null {
  const file = pending;
  pending = null;
  return file;
}

export function hasPendingUpload(): boolean {
  return pending !== null;
}
