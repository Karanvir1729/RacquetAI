/**
 * The on-device import-flow state machine: extract reference frame → corner
 * taps (the same CornerPicker as the server flow, on a local frame) → run
 * racquet-analyzer with live progress → validate, persist, done. Mirrors the
 * server machine in useImportFlow: one effect per attempt owns the run and a
 * per-attempt `run.cancelled` token gates every state write, so leaving the
 * screen mid-analysis can never resurrect a dead flow (the native run itself
 * has no cancel API — its result is simply dropped).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { adoptAnalysisVideo } from "@/lib/analysisVideo";
import { writeImportedAnalysis } from "@/lib/importedAnalyses";
import { makeImportedAnalysisId } from "@/lib/importedAnalysisId";

import {
  DeviceAnalysisError,
  extractDeviceReferenceFrame,
  runDeviceAnalysis,
} from "./deviceClient";
import { NO_VIDEO_STATE, type ImportFlow, type ImportFlowState } from "./importFlowState";
import type { CourtCorners } from "./jobContract";

/** Module-scope constant so re-renders compare by reference. */
const INITIAL_STATE: ImportFlowState = { phase: "extracting" };

function failureMessage(error: unknown): string {
  return error instanceof DeviceAnalysisError
    ? error.message
    : "Something went wrong analyzing the video on this device.";
}

/** One attempt's cancellation token; shared between the effect and callbacks. */
interface Run {
  cancelled: boolean;
}

export function useDeviceImportFlow(videoUri: string | null): ImportFlow {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ImportFlowState>(INITIAL_STATE);
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    if (videoUri === null) return; // rendered as NO_VIDEO_STATE below

    const run: Run = { cancelled: false };
    runRef.current = run;
    const safeSetState = (next: ImportFlowState) => {
      if (!run.cancelled) setState(next);
    };

    // No sync state reset here: mount starts at INITIAL_STATE and retry()
    // resets before bumping `attempt`, so the effect only reacts.
    extractDeviceReferenceFrame(videoUri)
      .then((frame) => {
        safeSetState({ phase: "corners", frameUri: frame.uri });
        // DEV autorun: hands-free end-to-end run in the simulator. Uses the
        // bundled sample clip's known calibration; stripped in production.
        if (__DEV__ && process.env.EXPO_PUBLIC_AUTORUN_SAMPLE === "1") {
          setTimeout(() => {
            void submitCornersRef.current?.({
              frontLeft: { x: 0.326146, y: 0.273704 },
              frontRight: { x: 0.684792, y: 0.274259 },
              backLeft: { x: -0.080729, y: 1.557593 },
              backRight: { x: 1.136667, y: 1.538704 },
            });
          }, 400);
        }
      })
      .catch((error: unknown) => safeSetState({ phase: "failed", message: failureMessage(error) }));

    return () => {
      run.cancelled = true;
      if (runRef.current === run) runRef.current = null;
    };
  }, [videoUri, attempt]);

  const retry = useCallback(() => {
    setState(INITIAL_STATE);
    setAttempt((current) => current + 1);
  }, []);

  const submitCornersRef = useRef<((corners: CourtCorners) => Promise<boolean>) | null>(null);
  const submitCorners = useCallback(
    async (corners: CourtCorners): Promise<boolean> => {
      const run = runRef.current;
      if (state.phase !== "corners" || run === null || run.cancelled || videoUri === null) {
        return false;
      }
      const safeSetState = (next: ImportFlowState) => {
        if (!run.cancelled) setState(next);
      };
      // Reflect the start immediately (the server flow's post-corners pattern);
      // the analysis itself runs detached so the CornerPicker's await resolves
      // now and the state machine, not the picker, tracks the long native run.
      safeSetState({
        phase: "analyzing",
        status: { status: "analyzing", progressPct: null, message: null },
      });
      void (async () => {
        try {
          const raw = await runDeviceAnalysis(videoUri, corners, (status) => {
            if (!run.cancelled) {
              setState((previous) =>
                previous.phase === "analyzing" ? { phase: "analyzing", status } : previous,
              );
            }
          });
          if (run.cancelled) return;
          safeSetState({ phase: "saving" });
          // runDeviceAnalysis already validated the JSON; persist it verbatim.
          const importedId = makeImportedAnalysisId();
          writeImportedAnalysis(importedId, raw);
          try {
            adoptAnalysisVideo(importedId, videoUri);
          } catch {
            // Video copy is garnish — the analysis page just hides the player.
          }
          safeSetState({ phase: "done", importedId });
        } catch (error) {
          safeSetState({ phase: "failed", message: failureMessage(error) });
        }
      })();
      return true;
    },
    [state, videoUri],
  );

  useEffect(() => {
    submitCornersRef.current = submitCorners;
  }, [submitCorners]);

  return { state: videoUri === null ? NO_VIDEO_STATE : state, retry, submitCorners };
}
