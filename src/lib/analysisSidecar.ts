/**
 * Analysis-sidecar file access. The offline pipeline drops `<id>.analysis.json`
 * next to `<id>.mov` in the recordings store — the same sidecar pattern as
 * recording metadata: the directory listing is the database, and
 * `deleteRecording`'s `<id>.*` prefix match cleans this file up with the
 * footage. Lives in src/lib because two features touch it: features/recording
 * shows the "View analysis" affordance and features/analysis loads the JSON.
 *
 * Reading returns raw text only; schema validation belongs to the analysis
 * feature (features/analysis/types.ts `parseAnalysis`).
 */
import { File } from "expo-file-system";

import { recordingsDirectory } from "./recordingsDir";

export function analysisSidecarName(id: string): string {
  return `${id}.analysis.json`;
}

/**
 * Whether the pipeline has produced an analysis for this recording. Called on
 * the Library render path, so a disk error reads as "no analysis" — never a
 * crashed list.
 */
export function hasAnalysisSidecar(id: string): boolean {
  try {
    return new File(recordingsDirectory(), analysisSidecarName(id)).exists;
  } catch {
    return false;
  }
}

/** Raw sidecar JSON text, or null when none exists. Disk errors throw — callers catch. */
export function readAnalysisSidecar(id: string): string | null {
  const file = new File(recordingsDirectory(), analysisSidecarName(id));
  return file.exists ? file.textSync() : null;
}
