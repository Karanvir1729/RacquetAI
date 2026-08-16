/**
 * Loading a recording's analysis: raw sidecar text via src/lib/analysisSidecar,
 * schema validation via `parseAnalysis`. Any failure — no file, disk error,
 * corrupt or wrong-version JSON — collapses to null and the screen's
 * "not available" state; a bad file must never crash the app.
 */
import { readAnalysisSidecar } from "@/lib/analysisSidecar";

import { parseAnalysis, type MatchAnalysis } from "./types";

export function loadAnalysisForRecording(id: string): MatchAnalysis | null {
  try {
    const raw = readAnalysisSidecar(id);
    return raw === null ? null : parseAnalysis(raw);
  } catch {
    return null;
  }
}
