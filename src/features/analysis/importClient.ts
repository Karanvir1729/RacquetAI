/**
 * Network layer for the import flow — the only file that talks HTTP. Response
 * bodies are narrowed by jobContract.ts parsers; every function either returns
 * a parsed value or throws an `ImportServerError` with a message that is safe
 * to render verbatim in the error state. The multipart upload goes through the
 * legacy expo-file-system `createUploadTask` because it is the one Expo API
 * with native upload progress callbacks (the new File API has none yet).
 */
import * as FileSystem from "expo-file-system/legacy";

import {
  analysisUrl,
  cornersBody,
  cornersUrl,
  jobsUrl,
  jobUrl,
  parseJobStatus,
  uploadFileName,
  videoMimeType,
  type CourtCorners,
  type JobStatus,
} from "./jobContract";

import { supabase } from "@/lib/supabaseClient";

/** A failure whose `message` is written for the user, not a stack trace. */
export class ImportServerError extends Error {}

export type UploadTask = FileSystem.UploadTask;

/**
 * Build (but do not start) the multipart upload of the picked video to
 * POST /jobs, field "video". `onProgress` receives a 0..1 fraction, or null
 * when the total size is unknown. Callers start it with `task.uploadAsync()`
 * and cancel with `task.cancelAsync()` on unmount.
 */
export async function createVideoUploadTask(
  baseUrl: string,
  videoUri: string,
  onProgress: (fraction: number | null) => void,
): Promise<UploadTask> {
  // Resolved before the task is built: /jobs is authenticated, and starting a
  // multi-hundred-MB upload that is certain to 401 wastes the whole transfer.
  const authHeaders = await authHeader();
  return FileSystem.createUploadTask(
    jobsUrl(baseUrl),
    videoUri,
    {
      httpMethod: "POST",
      // BINARY_CONTENT streams the file from disk. MULTIPART is off-limits
      // here: expo's iOS implementation buffers the entire file in memory
      // (twice) before sending, which for a match video is a multi-hundred-MB
      // spike that crashed the app on device. The server accepts a raw
      // video/* body with the original name in X-Filename.
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        "Content-Type": videoMimeType(videoUri),
        "X-Filename": uploadFileName(videoUri),
        ...authHeaders,
      },
      // Foreground-only: the flow screen owns the task lifecycle; a background
      // iOS session would outlive the screen that reports its progress.
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => {
      onProgress(totalBytesExpectedToSend > 0 ? totalBytesSent / totalBytesExpectedToSend : null);
    },
  );
}

/**
 * The signed-in user's access token as an Authorization header.
 *
 * Every /jobs route on the analysis server is authenticated — it previously
 * accepted an upload from anyone who knew the hostname, and served any job's
 * frame and analysis to a guessed id. Empty when signed out; the server then
 * answers 401 and the flow surfaces its message rather than guessing here.
 */
export async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ImportServerError(
      "Could not reach the analysis server. Check that it is running and that the server URL in Settings is right.",
    );
  }
  if (!response.ok) {
    throw new ImportServerError(`The analysis server responded with HTTP ${response.status}.`);
  }
  return response.text();
}

/** GET /jobs/{id} → parsed status. */
export async function fetchJobStatus(baseUrl: string, jobId: string): Promise<JobStatus> {
  const body = await fetchText(jobUrl(baseUrl, jobId), { headers: await authHeader() });
  const status = parseJobStatus(body);
  if (status === null) {
    throw new ImportServerError("The analysis server sent a status this app version can't read.");
  }
  return status;
}

/** POST /jobs/{id}/corners with normalized floor-corner coordinates. */
export async function postCorners(
  baseUrl: string,
  jobId: string,
  corners: CourtCorners,
): Promise<void> {
  await fetchText(cornersUrl(baseUrl, jobId), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: cornersBody(corners),
  });
}

/** GET /jobs/{id}/analysis.json → the raw JSON text (validated by the caller). */
export async function fetchAnalysisText(baseUrl: string, jobId: string): Promise<string> {
  return fetchText(analysisUrl(baseUrl, jobId), { headers: await authHeader() });
}
