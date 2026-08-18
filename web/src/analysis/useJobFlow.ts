/**
 * The analysis flow as one state machine: pick a file → upload → wait for the
 * server to prepare a reference frame → mark four corners → wait for the
 * analysis → read it.
 *
 * It lives in a hook rather than in the page so the stages are a single
 * discriminated union the view switches on, and so every transition has one
 * home. Two rules it enforces that are easy to get wrong in a component:
 *
 *  - polling stops the moment the stage no longer wants it (and on unmount),
 *    so a finished or abandoned job cannot leave a timer hammering the server;
 *  - the job id is surfaced so the page can put it in the URL. An analysis of
 *    a long match takes minutes; a refresh, a locked phone or a tab restore
 *    must be able to rejoin the same job rather than silently starting over.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AnalysisServerError,
  fetchAnalysis,
  fetchJobState,
  frameUrl,
  readApiBase,
  submitCorners,
  uploadVideo,
  type UploadHandle,
} from "./client";
import type { CourtCorners, JobState } from "./jobContract";
import type { MatchAnalysis } from "./types";

/** How often to ask the server where it has got to. */
const POLL_MS = 1500;
/**
 * Transient poll failures are normal on a phone: a dropped request, a screen
 * waking from lock, a proxy hiccup. Killing a 4-minute analysis on the first
 * one loses work the server is still happily doing, so tolerate a short run of
 * them — the same rule the iOS client uses.
 */
const MAX_POLL_FAILURES = 5;

export type FlowStage =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string; fileBytes: number; fraction: number }
  | { kind: "waiting"; jobId: string; state: JobState }
  | {
      kind: "corners";
      jobId: string;
      frameSrc: string;
      submitting: boolean;
      /** A rejected POST stays on this stage: the marks are still good. */
      error: string | null;
    }
  | { kind: "analyzing"; jobId: string; state: JobState }
  | { kind: "fetching"; jobId: string }
  | { kind: "done"; jobId: string; analysis: MatchAnalysis }
  | { kind: "error"; message: string; jobId: string | null };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AnalysisServerError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export interface JobFlow {
  stage: FlowStage;
  /** The base URL in force. Re-read whenever the settings panel changes it. */
  apiBase: string;
  setApiBase: (base: string) => void;
  start: (file: File) => void;
  /** Rejoin a job by id — used to restore from `?job=` on load. */
  resume: (jobId: string) => void;
  placeCorners: (corners: CourtCorners) => void;
  /** Abort an in-flight upload, or clear a finished/failed run. */
  reset: () => void;
}

export function useJobFlow(): JobFlow {
  const [stage, setStage] = useState<FlowStage>({ kind: "idle" });
  const [apiBase, setApiBase] = useState<string>(() => readApiBase());
  const uploadRef = useRef<UploadHandle | null>(null);
  // Guards every async continuation: a stale upload or fetch resolving after
  // the user hit "start over" must not resurrect the old job's UI.
  const runRef = useRef(0);

  useEffect(
    () => () => {
      runRef.current += 1;
      uploadRef.current?.cancel();
    },
    [],
  );

  const start = useCallback(
    (file: File) => {
      const run = (runRef.current += 1);
      setStage({ kind: "uploading", fileName: file.name, fileBytes: file.size, fraction: 0 });

      const handle = uploadVideo(apiBase, file, (fraction) => {
        if (runRef.current !== run) return;
        setStage((current) =>
          current.kind === "uploading" ? { ...current, fraction } : current,
        );
      });
      uploadRef.current = handle;

      handle.promise.then(
        (jobId) => {
          if (runRef.current !== run) return;
          uploadRef.current = null;
          setStage({
            kind: "waiting",
            jobId,
            state: { status: "queued", progressPct: 0, message: "queued on the server" },
          });
        },
        (error: unknown) => {
          if (runRef.current !== run) return;
          uploadRef.current = null;
          setStage({
            kind: "error",
            jobId: null,
            message: errorMessage(error, "The upload failed."),
          });
        },
      );
    },
    [apiBase],
  );

  const resume = useCallback((jobId: string) => {
    runRef.current += 1;
    setStage({
      kind: "waiting",
      jobId,
      state: { status: "queued", progressPct: null, message: "reconnecting to the job" },
    });
  }, []);

  const reset = useCallback(() => {
    runRef.current += 1;
    uploadRef.current?.cancel();
    uploadRef.current = null;
    setStage({ kind: "idle" });
  }, []);

  const placeCorners = useCallback(
    (corners: CourtCorners) => {
      if (stage.kind !== "corners" || stage.submitting) return;
      const run = (runRef.current += 1);
      const { jobId } = stage;
      setStage({ ...stage, submitting: true, error: null });

      submitCorners(apiBase, jobId, corners).then(
        () => {
          if (runRef.current !== run) return;
          setStage({
            kind: "analyzing",
            jobId,
            state: { status: "analyzing", progressPct: 5, message: "starting analysis" },
          });
        },
        (error: unknown) => {
          if (runRef.current !== run) return;
          // Recoverable, so it stays on this stage: the four marks are still
          // good and re-placing them by hand would be a punishment for a
          // dropped request.
          setStage((current) =>
            current.kind === "corners"
              ? {
                  ...current,
                  submitting: false,
                  error: errorMessage(error, "The server would not accept the corners."),
                }
              : current,
          );
        },
      );
    },
    [apiBase, stage],
  );

  // ---- polling ------------------------------------------------------------
  const polls = stage.kind === "waiting" || stage.kind === "analyzing";
  const jobId = polls ? stage.jobId : null;

  useEffect(() => {
    if (jobId === null) return;
    const controller = new AbortController();
    let timer = 0;
    let stopped = false;
    let pollFailures = 0;

    const tick = async () => {
      try {
        const state = await fetchJobState(apiBase, jobId, controller.signal);
        if (stopped) return;
        if (state.status === "corners_needed") {
          setStage({
            kind: "corners",
            jobId,
            // Cache-bust per job: the browser must not reuse a frame from an
            // earlier job at the same path when the dev server restarts.
            frameSrc: frameUrl(apiBase, jobId, Date.now()),
            submitting: false,
            error: null,
          });
          return;
        }
        if (state.status === "error") {
          setStage({
            kind: "error",
            jobId,
            message: state.message ?? "The analysis failed on the server.",
          });
          return;
        }
        if (state.status === "done") {
          // Hand off to the download effect below rather than fetching here:
          // moving to "fetching" stops the polling, which tears down THIS
          // effect and aborts its controller — a fetch started on it would
          // cancel itself the instant it began, and the flow would sit on
          // "reading the results" forever.
          setStage({ kind: "fetching", jobId });
          return;
        }
        setStage((current) => {
          // Ignore a poll that lands after the stage moved on under us.
          if (current.kind !== "waiting" && current.kind !== "analyzing") return current;
          if (current.jobId !== jobId) return current;
          return state.status === "analyzing"
            ? { kind: "analyzing", jobId, state }
            : { kind: "waiting", jobId, state };
        });
        pollFailures = 0;
        timer = window.setTimeout(() => void tick(), POLL_MS);
      } catch (error) {
        if (stopped) return;
        if (controller.signal.aborted) return;
        pollFailures += 1;
        if (pollFailures < MAX_POLL_FAILURES) {
          timer = window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        setStage({
          kind: "error",
          jobId,
          message: errorMessage(error, "Lost contact with the analysis server."),
        });
      }
    };

    void tick();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiBase, jobId]);

  // ---- the finished analysis ---------------------------------------------
  // Its own effect, with its own controller, keyed on being in the "fetching"
  // stage: two megabytes of pose data takes a moment, and the download must
  // outlive the polling loop that discovered the job was done.
  const fetchingJobId = stage.kind === "fetching" ? stage.jobId : null;

  useEffect(() => {
    if (fetchingJobId === null) return;
    const controller = new AbortController();
    let cancelled = false;

    fetchAnalysis(apiBase, fetchingJobId, controller.signal).then(
      (analysis) => {
        if (!cancelled) setStage({ kind: "done", jobId: fetchingJobId, analysis });
      },
      (error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setStage({
          kind: "error",
          jobId: fetchingJobId,
          message: errorMessage(error, "Could not download the finished analysis."),
        });
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, fetchingJobId]);

  return { stage, apiBase, setApiBase, start, resume, placeCorners, reset };
}
