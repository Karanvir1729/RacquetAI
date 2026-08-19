/**
 * What footage the Referee tab can score: every analysis already on this
 * phone, plus the bundled demo.
 *
 * Refereeing a video needs a SHOT STREAM, not a video file — the rally split
 * and the last-striker call both read `analysis.shots`. So the sources here are
 * analyses, not recordings: a take that has never been analysed cannot be
 * refereed, and this module says so by leaving it out of the list rather than
 * offering it and failing later.
 *
 * Everything is guarded. This runs on a render path (the picker opens from a
 * tab), and a disk error has to read as "no footage to score", never a crash
 * on the way into the screen — features/recording/storage.ts's rule.
 */
import { loadAnalysisForRecording } from "@/features/analysis/storage";
import { DEMO_ANALYSIS } from "@/features/analysis/demoAnalysis";
import type { MatchAnalysis } from "@/features/analysis/types";
import { hasAnalysisSidecar } from "@/lib/analysisSidecar";
import { readAnalysisVideoRef } from "@/lib/analysisVideo";
import { listImportedAnalyses } from "@/lib/importedAnalyses";
import { listRecordings } from "@/features/recording/storage";

/** Where a scorable analysis came from — the picker groups by this. */
export type VideoSourceKind = "recording" | "imported" | "demo";

export interface VideoSource {
  /** `loadAnalysisForRecording` id, or `demo` for the bundled sample. */
  id: string;
  kind: VideoSourceKind;
  /** ISO 8601. The demo has none — it is not from any particular day. */
  createdAt: string | null;
  /** Whole seconds, when the source knows; recordings do, imports do not. */
  durationSec: number | null;
  /**
   * The footage, when there is any. NULL is ordinary, not an error: the
   * bundled demo ships stats only, and an import that was analysed on the
   * server without adopting a copy of the clip has none either. A source
   * without a video is still scorable — it just cannot be WATCHED being
   * scored, so the screen folds it in one pass instead.
   */
  videoUri: string | null;
}

export const DEMO_SOURCE: VideoSource = {
  id: "demo",
  kind: "demo",
  createdAt: null,
  durationSec: null,
  // The bundled demo is stats only — AnalysisScreen hides its player for the
  // same reason. Playing it is not an option this app can offer.
  videoUri: null,
};

/**
 * Every analysis this phone can referee, newest first, with the demo pinned
 * last so it never displaces the user's own footage but is always available —
 * including on a Simulator, where there is no camera and no library at all.
 */
export function listVideoSources(): VideoSource[] {
  const sources: VideoSource[] = [];

  try {
    for (const entry of listRecordings()) {
      if (!hasAnalysisSidecar(entry.meta.id)) continue;
      sources.push({
        id: entry.meta.id,
        kind: "recording",
        createdAt: entry.meta.createdAt,
        durationSec: entry.meta.durationSec,
        // A recording IS its video; the file is right there in the store.
        videoUri: entry.videoUri,
      });
    }
  } catch {
    // A listing that throws means "no recordings to offer", not a dead screen.
  }

  try {
    for (const entry of listImportedAnalyses()) {
      sources.push({
        id: entry.id,
        kind: "imported",
        createdAt: entry.createdAt.toISOString(),
        durationSec: null,
        // Only imports that adopted a copy of the clip have one. The ref file
        // is read here, on the tap that opens the picker, rather than on a
        // render path — it is synchronous disk I/O.
        videoUri: readAnalysisVideoRef(entry.id),
      });
    }
  } catch {
    // Same.
  }

  sources.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  sources.push(DEMO_SOURCE);
  return sources;
}

/**
 * The analysis behind a source, or null when it cannot be read. The demo is
 * returned from memory; everything else goes through the same validated
 * sidecar read the Analysis screen uses, so a corrupt file degrades to "cannot
 * be scored" instead of producing a scoreline out of garbage.
 */
export function loadVideoAnalysis(source: VideoSource): MatchAnalysis | null {
  if (source.kind === "demo") return DEMO_ANALYSIS;
  try {
    return loadAnalysisForRecording(source.id);
  } catch {
    return null;
  }
}

/**
 * Can this source be watched while it is scored, or only folded in one pass?
 *
 * Loose null check and a length test on purpose. "Playable" gates whether the
 * screen hands a URI to a video player, and the failure it guards against is
 * a black box with working scrub controls and no error — so anything that is
 * not definitely a path (undefined from an older stored shape, an empty string
 * from a ref file written mid-crash) has to read as NOT playable.
 */
export function isPlayable(source: VideoSource): boolean {
  return source.videoUri != null && source.videoUri.length > 0;
}

/**
 * Why a source cannot be refereed, or null when it can.
 *
 * An analysis with no shots is the common case worth naming: a v1 file from a
 * take with no usable audio has full pose stats and an empty shot list, and
 * "0 rallies" with no explanation reads as a broken feature rather than as
 * footage the shot detector could not hear.
 */
export function unscorableReason(analysis: MatchAnalysis | null): string | null {
  if (analysis === null) return "This analysis could not be read.";
  if (analysis.shots.length === 0) {
    return analysis.quality.audioAvailable
      ? "No shots were detected in this video, so there are no rallies to score."
      : "This video had no usable audio. Shots are found by sound, so there is nothing to score.";
  }
  return null;
}
