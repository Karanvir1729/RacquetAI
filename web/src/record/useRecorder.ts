/**
 * Filming a match in a browser tab.
 *
 * The phone's Record tab, as far as the web platform goes: getUserMedia for
 * the preview, MediaRecorder for the take, a Wake Lock so the screen does not
 * sleep mid-rally. What the browser cannot do is keep the file — there is no
 * documents folder — so a finished take is handed straight to the analyzer or
 * downloaded, and the page says so rather than implying a library it does not
 * have.
 *
 * Container choice is not cosmetic. Safari's MediaRecorder gives mp4; Chrome
 * and Firefox give WebM (VP8/VP9 + Opus). The analysis server transcodes every
 * upload to h264 before it looks at a frame, so all three are fine — the list
 * below is ordered by what the analyzer handles most cheaply, and the first
 * supported entry wins.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export type RecorderPhase = "idle" | "ready" | "recording" | "done";

export interface Take {
  file: File;
  url: string;
  bytes: number;
  seconds: number;
}

export interface RecorderState {
  phase: RecorderPhase;
  /** Human-readable reason the camera is unavailable, or null. */
  error: string | null;
  /** Whole seconds filmed so far. */
  elapsedSec: number;
  take: Take | null;
  /** Cameras the visitor can choose between; empty until permission is granted. */
  cameras: MediaDeviceInfo[];
  deviceId: string | null;
  supported: boolean;
}

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/** "match-2026-08-20-1432.webm" — sortable, and obviously ours in a Downloads folder. */
function fileNameFor(mimeType: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `match-${stamp}.${extensionFor(mimeType)}`;
}

function describe(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser blocked access to the camera. Allow it for this site and try again — on most browsers that is the camera icon in the address bar.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Plug one in, or film on your phone and upload the file instead.";
  }
  if (name === "NotReadableError") {
    return "The camera is busy — another app or tab already has it. Close that one and try again.";
  }
  return "The camera could not be started on this browser. Filming on a phone and uploading the file works everywhere.";
}

export function useRecorder(): RecorderState & {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  open: (deviceId?: string) => Promise<void>;
  start: () => void;
  stop: () => void;
  discard: () => void;
} {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wake Lock is Chromium-and-newer-Safari only, and it is a nicety: without
  // it the screen may sleep, which stops the preview but not the recording.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const supported =
    typeof navigator !== "undefined" &&
    navigator.mediaDevices !== undefined &&
    pickMimeType() !== null;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  const open = useCallback(
    async (requestedDeviceId?: string) => {
      setError(null);
      try {
        releaseStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          video:
            requestedDeviceId === undefined
              ? { facingMode: "environment", width: { ideal: 1920 } }
              : { deviceId: { exact: requestedDeviceId }, width: { ideal: 1920 } },
          // The rally boundaries come from audio onsets, so a silent recording
          // is a recording the analyzer cannot split into rallies.
          audio: true,
        });
        streamRef.current = stream;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {
            /* autoplay policy; the element still shows the stream */
          });
        }
        // Labels are blank until permission is granted, so enumerate AFTER.
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((device) => device.kind === "videoinput"));
        setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
        setPhase("ready");
      } catch (caught) {
        releaseStream();
        setError(describe(caught));
        setPhase("idle");
      }
    },
    [releaseStream],
  );

  const start = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (stream === null || mimeType === null) return;

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const seconds = Math.round((Date.now() - startedAtRef.current) / 1000);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      const file = new File([blob], fileNameFor(mimeType, new Date()), { type: mimeType });
      setTake({ file, url: URL.createObjectURL(blob), bytes: blob.size, seconds });
      setPhase("done");
    };

    startedAtRef.current = Date.now();
    setElapsedSec(0);
    // A timeslice means chunks arrive as we go, so a crashed tab loses the
    // tail of a match rather than the whole thing.
    recorder.start(2000);
    setPhase("recording");

    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);

    void navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        wakeLockRef.current = lock;
      })
      .catch(() => {
        /* unsupported or denied — filming continues either way */
      });
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    const recorder = recorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }, []);

  const discard = useCallback(() => {
    setTake((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
    setElapsedSec(0);
    setPhase(streamRef.current === null ? "idle" : "ready");
  }, []);

  // The preview URL for a finished take is revoked when it is replaced and
  // when the page goes — `discard` revokes too, and a second revoke is a no-op.
  useEffect(() => {
    const url = take?.url;
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [take]);

  // Filming must stop when the page goes: a camera light left on after
  // navigating away is the single most alarming bug a recorder can have.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      void wakeLockRef.current?.release().catch(() => {});
      const recorder = recorderRef.current;
      if (recorder !== null && recorder.state !== "inactive") recorder.stop();
      releaseStream();
    },
    [releaseStream],
  );

  return {
    phase,
    error,
    elapsedSec,
    take,
    cameras,
    deviceId,
    supported,
    videoRef,
    open,
    start,
    stop,
    discard,
  };
}
