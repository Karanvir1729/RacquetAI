/**
 * On-disk store for analyses imported via the analysis server. Each import is
 * a single `<imp-id>.analysis.json` file in the recordings directory — the
 * same sidecar shape the offline pipeline drops next to recordings, so
 * `readAnalysisSidecar`/`loadAnalysisForRecording` read imported analyses with
 * zero changes and `/analysis?id=<imp-id>` just works. No index file: the
 * directory listing IS the database (features/recording/storage.ts pattern).
 *
 * Lives in src/lib because two features touch it: features/analysis writes
 * after an import finishes, features/recording lists it in the Library.
 */
import { File } from "expo-file-system";

import { deleteAnalysisVideoRef } from "./analysisVideo";
import {
  idFromImportedSidecarName,
  importedAnalysisTimestamp,
  importedSidecarName,
} from "./importedAnalysisId";
import { recordingsDirectory } from "./recordingsDir";

export interface ImportedAnalysisEntry {
  id: string;
  /** When the import happened (from the id's timestamp). */
  createdAt: Date;
}

/**
 * Persist a validated analysis payload under an imported id. Callers validate
 * with `parseAnalysis` BEFORE writing — this file is read back by the analysis
 * screen, and persisting garbage would turn into a silent "not available"
 * later. Disk errors throw; callers catch.
 */
export function writeImportedAnalysis(id: string, rawJson: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, importedSidecarName(id));
  if (!file.exists) file.create();
  file.write(rawJson);
}

/**
 * All imported analyses, newest first. Non-matching files are skipped, and a
 * disk error reads as an empty list at the caller (Library render path).
 */
export function listImportedAnalyses(): ImportedAnalysisEntry[] {
  const dir = recordingsDirectory();
  if (!dir.exists) return [];
  const entries: ImportedAnalysisEntry[] = [];
  for (const item of dir.list()) {
    if (!(item instanceof File)) continue;
    const id = idFromImportedSidecarName(item.name);
    if (id === null) continue;
    const createdAt = importedAnalysisTimestamp(id);
    if (createdAt === null) continue;
    entries.push({ id, createdAt });
  }
  return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Remove one imported analysis. Missing file is a no-op; disk errors throw. */
export function deleteImportedAnalysis(id: string): void {
  const dir = recordingsDirectory();
  if (!dir.exists) return;
  const file = new File(dir, importedSidecarName(id));
  if (file.exists) file.delete();
  deleteAnalysisVideoRef(id);
}
