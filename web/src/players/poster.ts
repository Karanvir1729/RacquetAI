/**
 * Poster frames — the one still that travels with a tag.
 *
 * The footage never leaves the browser that analysed it, and the server
 * deletes its copy after 48 hours; a profile on another machine would
 * otherwise have nothing to show for a recording but a row of numbers. So at
 * tag time, while the video is still playing in this tab, one frame is drawn
 * to a canvas and kept as a small JPEG against the clip. One frame, captured
 * here, never the file — that is the whole of what this module does.
 *
 * Best effort throughout: a browser that will not seek an object URL, a
 * tainted canvas, a video that never reports metadata — any of it yields
 * null, and the profile falls back to drawing the court plan instead. Nothing
 * here may throw into the tag flow it decorates.
 */
import type { MatchAnalysis } from "@/analysis/types";

/** How long the whole capture may take before it is given up as null. */
const CAPTURE_TIMEOUT_MS = 6000;

/** Keep off the very first and very last frames, which are often black. */
const EDGE_SEC = 0.2;

/** A beat after the first contact — the swing is over, both players are in frame. */
const AFTER_FIRST_SHOT_SEC = 0.6;

/** HAVE_CURRENT_DATA: the frame at currentTime is decoded and can be drawn. */
const HAVE_CURRENT_DATA = 2;

/**
 * The moment to take the still from: just after the first detected shot, so
 * the frame has play in it — not the pre-serve wait, which on club footage is
 * a player tying a shoelace. With no shots at all, a quarter of the way in.
 */
export function posterTime(analysis: MatchAnalysis): number {
  let first: number | null = null;
  for (const shot of analysis.shots) {
    if (first === null || shot.tSec < first) first = shot.tSec;
  }
  if (first !== null) return first + AFTER_FIRST_SHOT_SEC;
  return analysis.video.durationSec * 0.25;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Resolve on one of `events`, reject on "error"; `once`, and tidy either way. */
function waitFor(video: HTMLVideoElement, events: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      for (const name of events) video.removeEventListener(name, done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      for (const name of events) video.removeEventListener(name, done);
      video.removeEventListener("error", fail);
      reject(new Error("video error"));
    };
    for (const name of events) video.addEventListener(name, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

/**
 * One JPEG frame of `videoSrc` at `atSec`, `width` pixels across (height by
 * the footage's own aspect). Null on any failure, and never later than
 * CAPTURE_TIMEOUT_MS — the tag has already landed by the time this runs, and
 * nothing waits on it.
 */
export async function capturePoster(
  videoSrc: string,
  atSec: number,
  width = 640,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const video = document.createElement("video");
  let timer: number | null = null;

  const capture = async (): Promise<Blob | null> => {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // Object URLs are same-origin; for anything remote this asks for CORS so
    // the canvas is not tainted (an untainted canvas is the only kind that
    // will hand back a blob).
    video.crossOrigin = "anonymous";
    video.src = videoSrc;

    if (video.readyState < 1) await waitFor(video, ["loadedmetadata"]);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const target =
      duration === null ? Math.max(EDGE_SEC, atSec) : clamp(atSec, EDGE_SEC, Math.max(EDGE_SEC, duration - EDGE_SEC));

    const seeked = waitFor(video, ["seeked"]);
    video.currentTime = target;
    await seeked;
    // Safari can fire "seeked" a tick before the frame is decoded; draw only
    // once there is a frame to draw.
    if (video.readyState < HAVE_CURRENT_DATA) await waitFor(video, ["loadeddata", "canplay"]);

    if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0, w, h);
    return new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
      } catch {
        resolve(null);
      }
    });
  };

  const deadline = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([capture(), deadline]);
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
    // Let the element go: drop the source so the decoder is released rather
    // than held by a detached <video> until the tab is closed.
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* nothing to release */
    }
  }
}
