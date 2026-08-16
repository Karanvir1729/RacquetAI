/**
 * The import-flow state machine: upload → poll → (corners) → poll → fetch,
 * validate, persist → done. One effect per attempt owns the whole lifecycle —
 * upload task, 2-second poll interval, finalization — and tears all of it down
 * on unmount or retry, so a half-dead flow can never keep polling behind a
 * screen that left. Every server payload crosses jobContract/parseAnalysis
 * narrowing before it can drive the UI.
 */
import { useCallback, useEffect, useState } from "react";

import { makeImportedAnalysisId } from "@/lib/importedAnalysisId";
import { writeImportedAnalysis } from "@/lib/importedAnalyses";

import {
  createVideoUploadTask,
  fetchAnalysisText,
  fetchJobStatus,
  ImportServerError,
  postCorners,
} from "./importClient";
import { parseJobCreated, type CourtCorners, type JobStatus } from "./jobContract";
import { loadServerBaseUrl } from "./serverConfig";
import { parseAnalysis } from "./types";

const POLL_INTERVAL_MS = 2000;
/** Tolerated consecutive poll failures (transient Wi-Fi blips) before erroring. */
const MAX_POLL_FAILURES = 5;

export type ImportFlowState =
  | { phase: "uploading"; progress: number | null }
  | { phase: "job"; baseUrl: string; jobId: string; status: JobStatus }
  | { phase: "saving" }
  | { phase: "done"; importedId: string }
  | { phase: "failed"; message: string };

interface ImportFlow {
  state: ImportFlowState;
  /** Restart the whole flow (re-upload) after a failure. */
  retry: () => void;
  /** POST the four corners; false = request failed and the picker should say so. */
  submitCorners: (corners: CourtCorners) => Promise<boolean>;
}

function failureMessage(error: unknown): string {
  return error instanceof ImportServerError
    ? error.message
    : "Something went wrong talking to the analysis server.";
}

/** Module-scope constants so re-renders compare by reference. */
const INITIAL_STATE: ImportFlowState = { phase: "uploading", progress: 0 };
const NO_VIDEO_STATE: ImportFlowState = {
  phase: "failed",
  message: "No video was selected. Go back to the Library and pick one.",
};

export function useImportFlow(videoUri: string | null): ImportFlow {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ImportFlowState>(INITIAL_STATE);

  useEffect(() => {
    if (videoUri === null) return; // rendered as NO_VIDEO_STATE below

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let pollBusy = false;
    let pollFailures = 0;
    const baseUrl = loadServerBaseUrl();

    const safeSetState = (next: ImportFlowState) => {
      if (!cancelled) setState(next);
    };
    const fail = (message: string) => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      safeSetState({ phase: "failed", message });
    };

    const finalize = async (jobId: string) => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      safeSetState({ phase: "saving" });
      try {
        const raw = await fetchAnalysisText(baseUrl, jobId);
        // Validate BEFORE persisting — a schema-drifted payload must fail here,
        // loudly, not as a silent "not available" on the analysis screen later.
        if (parseAnalysis(raw) === null) {
          fail("The analysis finished but its result uses a format this app version can't read.");
          return;
        }
        const importedId = makeImportedAnalysisId();
        writeImportedAnalysis(importedId, raw);
        safeSetState({ phase: "done", importedId });
      } catch (error) {
        fail(failureMessage(error));
      }
    };

    const poll = async (jobId: string) => {
      if (pollBusy || cancelled) return; // never stack requests on a slow server
      pollBusy = true;
      try {
        const status = await fetchJobStatus(baseUrl, jobId);
        pollFailures = 0;
        if (cancelled) return;
        if (status.status === "done") {
          void finalize(jobId);
        } else if (status.status === "error") {
          fail(status.message ?? "The analysis failed on the server.");
        } else {
          safeSetState({ phase: "job", baseUrl, jobId, status });
        }
      } catch (error) {
        pollFailures += 1;
        if (pollFailures >= MAX_POLL_FAILURES) fail(failureMessage(error));
      } finally {
        pollBusy = false;
      }
    };

    const startPolling = (jobId: string) => {
      safeSetState({
        phase: "job",
        baseUrl,
        jobId,
        status: { status: "queued", progressPct: null, message: null },
      });
      interval = setInterval(() => void poll(jobId), POLL_INTERVAL_MS);
      void poll(jobId);
    };

    // No sync state reset here: mount starts at INITIAL_STATE and retry()
    // resets before bumping `attempt`, so the effect only reacts.
    const task = createVideoUploadTask(baseUrl, videoUri, (progress) => {
      safeSetState({ phase: "uploading", progress });
    });
    task
      .uploadAsync()
      .then((result) => {
        if (cancelled) return;
        if (result === null || result === undefined) return; // cancelled task
        if (result.status < 200 || result.status >= 300) {
          fail(`The analysis server rejected the upload (HTTP ${result.status}).`);
          return;
        }
        const jobId = parseJobCreated(result.body);
        if (jobId === null) {
          fail("The analysis server accepted the upload but sent an unreadable reply.");
          return;
        }
        startPolling(jobId);
      })
      .catch(() => {
        if (!cancelled) {
          fail(
            `Could not upload to ${baseUrl}. Check that the analysis server is running and that ` +
              "the server URL in Settings is right.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (interval !== null) clearInterval(interval);
      void task.cancelAsync().catch(() => {});
    };
  }, [videoUri, attempt]);

  const retry = useCallback(() => {
    setState(INITIAL_STATE);
    setAttempt((current) => current + 1);
  }, []);

  const submitCorners = useCallback(
    async (corners: CourtCorners): Promise<boolean> => {
      if (state.phase !== "job") return false;
      try {
        await postCorners(state.baseUrl, state.jobId, corners);
      } catch {
        return false;
      }
      // The server is now analyzing; reflect it immediately rather than waiting
      // out the current poll interval. The next poll confirms.
      setState((previous) =>
        previous.phase === "job"
          ? {
              ...previous,
              status: { status: "analyzing", progressPct: null, message: null },
            }
          : previous,
      );
      return true;
    },
    [state],
  );

  return { state: videoUri === null ? NO_VIDEO_STATE : state, retry, submitCorners };
}
