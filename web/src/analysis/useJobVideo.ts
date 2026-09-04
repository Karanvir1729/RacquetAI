import { useEffect, useRef, useState } from "react";

import { fetchAnalysis, fetchJobVideo, readApiBase } from "./client";
import type { MatchAnalysis } from "./types";

/**
 * The footage for a read-out that has no local copy of it.
 *
 * A read-out plays the file the browser uploaded, which is instant and means
 * the footage never has to travel. But that file only exists in the tab that
 * did the upload, so three surfaces used to end up with numbers and an empty
 * frame: a job rejoined by `?job=`, a match reopened from Your matches, and a
 * clip opened from a player's profile. All three know the job id, and the
 * server still has its 854px working copy until the retention sweep, so all
 * three can just ask for it.
 *
 * `gone` is the honest and common answer — jobs are deleted after
 * JOB_TTL_HOURS, and a clip tagged from a saved match never had a job at all.
 * The caller says so rather than pretending a video is on its way.
 */
export type JobVideo =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "gone" }
  | { kind: "tooLarge"; bytes: number };

/**
 * Fetch a job's video once, as an object URL.
 *
 * Pass `skip` when the caller already has the real file — there is no reason
 * to pull a second copy over the network to show the same match.
 *
 * The "already asked" guard is a ref rather than the state this sets. Deriving
 * it from the state would re-run the effect the moment it moved to `loading`,
 * and the cleanup would abort the request it had just started — the panel then
 * waits forever for a fetch that was cancelled a millisecond after it began.
 */
export function useJobVideo(jobId: string | null, skip = false): JobVideo {
  const [state, setState] = useState<JobVideo>({ kind: "idle" });
  const askedFor = useRef<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  // Revoked on unmount only: revoking whenever the effect re-runs would pull
  // the URL out from under a <video> that is still playing from it.
  useEffect(
    () => () => {
      if (objectUrl.current !== null) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  useEffect(() => {
    if (skip || jobId === null) return;
    if (askedFor.current === jobId) return;
    askedFor.current = jobId;

    const controller = new AbortController();
    setState({ kind: "loading" });

    fetchJobVideo(readApiBase(), jobId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result === null) setState({ kind: "gone" });
        else if ("tooLarge" in result) setState({ kind: "tooLarge", bytes: result.tooLarge });
        else {
          const url = URL.createObjectURL(result.blob);
          objectUrl.current = url;
          setState({ kind: "ready", url });
        }
      },
      () => {
        // A signed-out visitor, an expired job, an unreachable server: all of
        // them mean the same thing to the page — there is no video to show.
        if (!controller.signal.aborted) setState({ kind: "gone" });
      },
    );

    return () => controller.abort();
  }, [jobId, skip]);

  return state;
}

/**
 * The FULL analysis for a job, when the one in hand has no pose track.
 *
 * A clip stored against a profile keeps the numbers but not `tracks` — the
 * pose samples are most of the bytes, and a profile only needs the summary.
 * That is why a stored read-out says "no pose track" and draws no skeleton.
 * The analysis server still has the whole thing next to the video, so when the
 * job is alive the overlay can be restored by asking for it.
 *
 * Returns null while there is nothing better than what the caller already has.
 */
export function useJobAnalysis(jobId: string | null, skip = false): MatchAnalysis | null {
  const [full, setFull] = useState<MatchAnalysis | null>(null);
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (skip || jobId === null) return;
    if (askedFor.current === jobId) return;
    askedFor.current = jobId;

    const controller = new AbortController();
    fetchAnalysis(readApiBase(), jobId, controller.signal).then(
      (analysis) => {
        if (controller.signal.aborted) return;
        // Only worth swapping in if it actually carries what was missing.
        if (analysis.tracks !== undefined && analysis.tracks.length > 0) setFull(analysis);
      },
      () => {
        // Expired job, signed out, server down — keep the stored analysis.
      },
    );
    return () => controller.abort();
  }, [jobId, skip]);

  return full;
}
