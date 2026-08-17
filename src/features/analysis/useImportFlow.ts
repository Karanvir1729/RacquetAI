/**
 * The import flow's entry hook. `useImportFlow` resolves the analysis backend
 * once per mount — the persisted setting, downgraded to "server" whenever the
 * racquet-analyzer module is unavailable (Expo Go) — and hands the video to
 * either the on-device machine (useDeviceImportFlow) or the server machine
 * below. Exactly one machine gets the real videoUri; the other idles on null,
 * keeping hook order stable.
 *
 * The server machine: upload → poll → (corners) → poll → fetch, validate,
 * persist → done. One effect per attempt owns the whole lifecycle — upload
 * task, 2-second poll interval, finalization — and tears all of it down on
 * unmount or retry, so a half-dead flow can never keep polling behind a screen
 * that left. Every server payload crosses jobContract/parseAnalysis narrowing
 * before it can drive the UI.
 */
import { useCallback, useEffect, useState } from "react";

import { adoptAnalysisVideo } from "@/lib/analysisVideo";
import { writeImportedAnalysis } from "@/lib/importedAnalyses";
import { makeImportedAnalysisId } from "@/lib/importedAnalysisId";

import { isDeviceAnalysisAvailable, loadAnalysisBackend, resolveBackend } from "./backend";
import { compressForUpload } from "./deviceClient";
import {
  createVideoUploadTask,
  fetchAnalysisText,
  fetchJobStatus,
  ImportServerError,
  postCorners,
  type UploadTask,
} from "./importClient";
import { NO_VIDEO_STATE, type ImportFlow, type ImportFlowState } from "./importFlowState";
import { parseJobCreated, type CourtCorners } from "./jobContract";
import { loadServerBaseUrl } from "./serverConfig";
import { parseAnalysis } from "./types";
import { useDeviceImportFlow } from "./useDeviceImportFlow";

export type { ImportFlow, ImportFlowState };

const POLL_INTERVAL_MS = 2000;
/** Tolerated consecutive poll failures (transient Wi-Fi blips) before erroring. */
const MAX_POLL_FAILURES = 5;

function failureMessage(error: unknown): string {
  return error instanceof ImportServerError
    ? error.message
    : "Something went wrong talking to the analysis server.";
}

/** Module-scope constant so re-renders compare by reference. */
const INITIAL_STATE: ImportFlowState = { phase: "uploading", progress: 0 };

/**
 * Backend-aware dispatcher. The decision is taken once per mount: flipping the
 * setting mid-import must not orphan a running upload or native analysis.
 */
export function useImportFlow(videoUri: string | null): ImportFlow {
  const [backend] = useState(() =>
    resolveBackend(loadAnalysisBackend(), isDeviceAnalysisAvailable()),
  );
  const device = useDeviceImportFlow(backend === "device" ? videoUri : null);
  const server = useServerImportFlow(backend === "server" ? videoUri : null);
  return backend === "device" ? device : server;
}

function useServerImportFlow(videoUri: string | null): ImportFlow {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ImportFlowState>(INITIAL_STATE);

  useEffect(() => {
    if (videoUri === null) return; // rendered as NO_VIDEO_STATE below

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let pollBusy = false;
    let pollFailures = 0;
    // What actually gets uploaded (and later adopted as the match video):
    // the compressed export when compression succeeds, the original otherwise.
    let uploadUri = videoUri;
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
        try {
          adoptAnalysisVideo(importedId, uploadUri);
        } catch {
          // Video copy is garnish — the analysis page just hides the player.
        }
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
    let task: UploadTask | null = null;
    void (async () => {
      // Best-effort 960x540 export first — a camera original is ~10x the
      // upload (and the server downscales to 854px regardless). Falls back to
      // the original URI when unavailable; uploadUri is also what finalize
      // adopts as the match video, so playback matches what was analyzed.
      safeSetState({ phase: "compressing" });
      uploadUri = await compressForUpload(videoUri);
      if (cancelled) return;
      task = createVideoUploadTask(baseUrl, uploadUri, (progress) => {
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
    })();

    return () => {
      cancelled = true;
      if (interval !== null) clearInterval(interval);
      void task?.cancelAsync().catch(() => {});
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
