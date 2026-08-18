/**
 * HTTP client for the analysis server. Every response is narrowed through
 * jobContract.ts / types.ts before it reaches React — nothing here trusts the
 * wire, because "the server returned something odd" must surface as a message
 * in the flow, never as a crashed render.
 *
 * ## Where the server is
 * In `npm run dev` the Vite proxy forwards `/api/*` to localhost:8082, so the
 * default base is `/api` and the browser stays same-origin. A deployed build
 * has no proxy, so the base is overridable two ways: `VITE_ANALYSIS_API` at
 * build time, and a field in the Analyze page at runtime (persisted in
 * localStorage). The runtime override exists because the honest answer to
 * "where does my video go?" is "to a server you point this at" — this site
 * does not host one.
 */
import {
  parseJobId,
  parseJobState,
  parseServerError,
  type CourtCorners,
  type JobState,
} from "./jobContract";
import { parseAnalysisValue, type MatchAnalysis } from "./types";

const STORAGE_KEY = "racquetiq.analysisServer";

const BUILD_DEFAULT: string =
  typeof import.meta.env.VITE_ANALYSIS_API === "string" &&
  import.meta.env.VITE_ANALYSIS_API.length > 0
    ? import.meta.env.VITE_ANALYSIS_API
    : "/api";

/** Trailing slashes would double up in every path we build. */
function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

export function defaultApiBase(): string {
  return normalizeBase(BUILD_DEFAULT);
}

/** The base in force: the visitor's override if they set one, else the build's. */
export function readApiBase(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null && stored.trim().length > 0) return normalizeBase(stored);
  } catch {
    // Private mode, disabled storage — fall through to the build default.
  }
  return defaultApiBase();
}

/** Persist an override, or clear it by passing the empty string. */
export function writeApiBase(base: string): void {
  try {
    if (base.trim().length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, normalizeBase(base));
  } catch {
    // Not being able to remember the base is survivable; the session still works.
  }
}

/** An error we can put in front of a person, with the server's own words when it gave any. */
export class AnalysisServerError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AnalysisServerError";
    this.status = status;
  }
}

async function readError(response: Response, fallback: string): Promise<AnalysisServerError> {
  let detail: string | null = null;
  try {
    detail = parseServerError(await response.json());
  } catch {
    detail = null;
  }
  return new AnalysisServerError(detail ?? fallback, response.status);
}

/** Where the reference frame lives. `bust` re-fetches after a re-upload. */
export function frameUrl(base: string, jobId: string, bust?: number): string {
  const suffix = bust === undefined ? "" : `?t=${bust}`;
  return `${normalizeBase(base)}/jobs/${encodeURIComponent(jobId)}/frame.jpg${suffix}`;
}

/**
 * Is anything listening? Used only to colour a dot in the UI, so a failure
 * here is `false`, never an exception.
 */
export async function checkHealth(base: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${normalizeBase(base)}/health`, { signal });
    return response.ok;
  } catch {
    return false;
  }
}

export interface UploadHandle {
  /** Resolves with the job id, or rejects with an AnalysisServerError. */
  promise: Promise<string>;
  /** Abort the transfer; the promise rejects with a cancellation error. */
  cancel: () => void;
}

/**
 * Upload a video and start a job.
 *
 * XMLHttpRequest, not `fetch`, for one reason: upload progress. A match video
 * is hundreds of megabytes and `fetch` gives no way to report how far it has
 * got, which on a phone connection is the difference between "working" and
 * "broken". The body is a raw `video/*` stream with `X-Filename` — the second
 * shape `POST /jobs` accepts — because it avoids buffering a multipart copy of
 * a large file in memory.
 */
export function uploadVideo(
  base: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  const promise = new Promise<string>((resolve, reject) => {
    request.open("POST", `${normalizeBase(base)}/jobs`);
    request.responseType = "json";
    // The server keys the extension off the content type for raw bodies:
    // "quicktime" means .mov, everything else .mp4.
    request.setRequestHeader("Content-Type", file.type || "video/mp4");
    request.setRequestHeader("X-Filename", encodeSafeFilename(file.name));

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    };
    request.upload.onload = () => onProgress(1);

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        const detail = parseServerError(request.response);
        reject(
          new AnalysisServerError(
            detail ?? `The server rejected the upload (HTTP ${request.status}).`,
            request.status,
          ),
        );
        return;
      }
      const jobId = parseJobId(request.response);
      if (jobId === null) {
        reject(new AnalysisServerError("The server started a job but did not return its id."));
        return;
      }
      resolve(jobId);
    };
    request.onerror = () =>
      reject(
        new AnalysisServerError(
          "Could not reach the analysis server. Check the address and that it is running.",
        ),
      );
    request.onabort = () => reject(new AnalysisServerError("Upload cancelled."));
    request.ontimeout = () => reject(new AnalysisServerError("The upload timed out."));

    request.send(file);
  });

  return { promise, cancel: () => request.abort() };
}

/**
 * A header value must be Latin-1; a filename can be anything a phone allows.
 * The name is provenance only (it lands in `analysis.json`'s `source`), so
 * transliterating away the un-encodable characters loses nothing that matters.
 */
function encodeSafeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[^\x20-\x7E]/g, "_").slice(0, 180) || "upload.mp4";
}

export async function fetchJobState(
  base: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<JobState> {
  const response = await fetch(`${normalizeBase(base)}/jobs/${encodeURIComponent(jobId)}`, {
    signal,
  });
  if (!response.ok) throw await readError(response, `Could not read the job (HTTP ${response.status}).`);
  const state = parseJobState(await response.json());
  if (state === null) throw new AnalysisServerError("The server sent a job status we can't read.");
  return state;
}

export async function submitCorners(
  base: string,
  jobId: string,
  corners: CourtCorners,
): Promise<void> {
  // The endpoint wants [nx, ny] pairs, unclamped: a court corner really can
  // sit outside the camera frame, and squeezing it into 0..1 would skew the
  // homography for the whole match.
  const body = {
    frontLeft: [corners.frontLeft.x, corners.frontLeft.y],
    frontRight: [corners.frontRight.x, corners.frontRight.y],
    backLeft: [corners.backLeft.x, corners.backLeft.y],
    backRight: [corners.backRight.x, corners.backRight.y],
  };
  const response = await fetch(`${normalizeBase(base)}/jobs/${encodeURIComponent(jobId)}/corners`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readError(response, `The server rejected the corners (HTTP ${response.status}).`);
  }
}

export async function fetchAnalysis(
  base: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<MatchAnalysis> {
  const response = await fetch(
    `${normalizeBase(base)}/jobs/${encodeURIComponent(jobId)}/analysis.json`,
    { signal },
  );
  if (!response.ok) {
    throw await readError(response, `Could not download the analysis (HTTP ${response.status}).`);
  }
  const analysis = parseAnalysisValue(await response.json());
  if (analysis === null) {
    throw new AnalysisServerError(
      "The analysis finished but the file doesn't match the schema this site can read.",
    );
  }
  return analysis;
}
