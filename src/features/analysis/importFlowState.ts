/**
 * The one state model both import flows drive — the server upload flow
 * (useImportFlow's server machine) and the on-device flow
 * (useDeviceImportFlow) — so ImportAnalysisScreen renders either backend from
 * a single union and the two hooks stay interchangeable behind `ImportFlow`.
 *
 * Server-only phases: "uploading", "job". Device-only phases: "extracting",
 * "corners", "analyzing" (the last reuses JobStatus so device progress renders
 * through the same status UI as server progress). Shared: "saving", "done",
 * "failed".
 */
import type { CourtCorners, JobStatus } from "./jobContract";

export type ImportFlowState =
  | { phase: "uploading"; progress: number | null }
  | { phase: "job"; baseUrl: string; jobId: string; status: JobStatus }
  | { phase: "extracting" }
  | { phase: "corners"; frameUri: string }
  | { phase: "analyzing"; status: JobStatus }
  | { phase: "saving" }
  | { phase: "done"; importedId: string }
  | { phase: "failed"; message: string };

export interface ImportFlow {
  state: ImportFlowState;
  /** Restart the whole flow from the beginning after a failure. */
  retry: () => void;
  /** Submit the four corners; false = the attempt failed and the picker should say so. */
  submitCorners: (corners: CourtCorners) => Promise<boolean>;
}

/** Module-scope constant so re-renders compare by reference. */
export const NO_VIDEO_STATE: ImportFlowState = {
  phase: "failed",
  message: "No video was selected. Go back to the Library and pick one.",
};
