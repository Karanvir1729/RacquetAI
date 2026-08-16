/**
 * Location of the on-device recordings store (`<documents>/recordings/`).
 * Promoted from features/recording/storage.ts so features/analysis can locate
 * a recording's analysis sidecar without importing another feature's internals
 * (docs/01 rule 2 — shared things graduate to src/lib).
 */
import { Directory, Paths } from "expo-file-system";

export function recordingsDirectory(): Directory {
  return new Directory(Paths.document, "recordings");
}
