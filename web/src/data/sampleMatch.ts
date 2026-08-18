/**
 * The bundled sample analysis: the real schemaVersion-2 output of
 * `analysis/out/archive_match2_v2/analysis.json`, over the footage it was
 * computed from.
 *
 * Both files are copied into `public/sample/`, not imported as modules. The
 * analysis is two megabytes of pose track — inlining it would put all of that
 * in the JavaScript bundle and make the landing page pay for a route most
 * visitors never open. Fetching it also means the demo travels the same code
 * path a real job does: an HTTP response, narrowed by `parseAnalysisValue`
 * before anything renders it.
 *
 * The video is the same recording, re-encoded for the web (854x480, CRF 30) so
 * the page is 14 MB rather than 44. The measurements were computed on the
 * original; nothing here re-derives them.
 */

const BASE = import.meta.env.BASE_URL;

export const SAMPLE_ANALYSIS_URL = `${BASE}sample/analysis.json`;
export const SAMPLE_VIDEO_URL = `${BASE}sample/match.mp4`;

/** Shown under the player. The licence is a condition of using this footage. */
export const SAMPLE_CAPTION =
  "Club-grade match footage from archive.org, CC BY-NC 4.0 — re-encoded to 854×480 for the web. " +
  "The analysis was computed on the original recording by the same pipeline the app uses.";
