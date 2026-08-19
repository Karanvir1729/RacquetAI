/**
 * Refereeing a video, end to end: pick an analysis, split it into rallies,
 * fold it into a score, load that into the same match the tap buttons drive.
 *
 * The result is NOT a separate kind of match. It is the ordinary event list
 * with rally events in it, so undo works one rally at a time, the buttons keep
 * scoring from wherever it left off, and the sidecar on disk is the same shape
 * it has always been. That is deliberate: a "video match" the rest of the
 * screen could not touch would be a second source of truth, and a scoreline
 * this heuristic produces is exactly the kind that needs correcting by hand.
 *
 * The binding and the first server are BOTH correctable after the fact and
 * both re-run the whole fold, because getting either wrong mirrors or shifts
 * every rally in the video and there is no way to tell from the numbers alone.
 */
import { useCallback, useState } from "react";

import type { MatchAnalysis } from "@/features/analysis/types";

import { PlayerNames } from "./announce";
import { Side } from "./types";
import {
  DEFAULT_PLAYER_BINDING,
  flipPlayerBinding,
  PlayerBinding,
  refereeVideo,
  VideoRefereeResult,
  videoResultCall,
} from "./videoReferee";
import { loadVideoAnalysis, unscorableReason, VideoSource } from "./videoSources";

/** A refereed video: what was scored, from where, and how to change it. */
export interface VideoRefereeState {
  source: VideoSource | null;
  result: VideoRefereeResult | null;
  /** Why the chosen source could not be scored, in a sentence for the user. */
  problem: string | null;
  binding: PlayerBinding;
  firstServer: Side;
}

export interface VideoReferee extends VideoRefereeState {
  /** Score a source and load it into the match. */
  score: (source: VideoSource) => void;
  /** Re-run with the analyser's A/B swapped — mirrors the whole scoreline. */
  swapPlayers: () => void;
  /** Re-run with the other player serving first. */
  setFirstServer: (side: Side) => void;
  /** Forget the video result; the match itself is left alone. */
  clear: () => void;
}

export interface UseVideoRefereeOptions {
  names: PlayerNames;
  /** Replace the match with these events, announcing `line`. */
  onLoad: (setup: { names: PlayerNames; firstServer: Side }, result: VideoRefereeResult) => void;
  /** Injectable for tests; the screen never passes it. */
  loadAnalysis?: (source: VideoSource) => MatchAnalysis | null;
}

export function useVideoReferee({
  names,
  onLoad,
  loadAnalysis = loadVideoAnalysis,
}: UseVideoRefereeOptions): VideoReferee {
  const [state, setState] = useState<VideoRefereeState>({
    source: null,
    result: null,
    problem: null,
    binding: DEFAULT_PLAYER_BINDING,
    firstServer: "A",
  });

  /**
   * The one path that turns a source into a loaded match. Every entry point —
   * first pick, swap, re-serve — goes through it, so a corrected scoreline can
   * never be produced by a different code path than the original one.
   */
  const run = useCallback(
    (source: VideoSource, binding: PlayerBinding, firstServer: Side) => {
      const analysis = loadAnalysis(source);
      const problem = unscorableReason(analysis);
      if (analysis === null || problem !== null) {
        setState({ source, result: null, problem, binding, firstServer });
        return;
      }
      const result = refereeVideo(analysis.shots, { binding, firstServer });
      setState({ source, result, problem: null, binding, firstServer });
      onLoad({ names, firstServer }, result);
    },
    [loadAnalysis, names, onLoad],
  );

  const score = useCallback(
    (source: VideoSource) => run(source, state.binding, state.firstServer),
    [run, state.binding, state.firstServer],
  );

  const swapPlayers = useCallback(() => {
    if (state.source === null) return;
    run(state.source, flipPlayerBinding(state.binding), state.firstServer);
  }, [run, state.binding, state.firstServer, state.source]);

  const setFirstServer = useCallback(
    (side: Side) => {
      if (state.source === null) return;
      run(state.source, state.binding, side);
    },
    [run, state.binding, state.source],
  );

  const clear = useCallback(
    () => setState((previous) => ({ ...previous, source: null, result: null, problem: null })),
    [],
  );

  return { ...state, score, swapPlayers, setFirstServer, clear };
}

/** The line spoken when a video finishes scoring. Kept here so the screen's
 * load callback and the tests agree on one wording. */
export function videoLoadCall(
  result: VideoRefereeResult,
  names: PlayerNames,
): string {
  return videoResultCall(result.score, names, result.rallies.length - result.ignoredAfterMatch);
}
