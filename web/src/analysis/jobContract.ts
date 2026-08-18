/**
 * The `analysis/server.py` job contract, narrowed the same way the analysis
 * payload is. Mirrors the app's `src/features/analysis/jobContract.ts`.
 *
 *   POST /jobs                    multipart "video" | raw video/* + X-Filename
 *                                 -> { jobId }
 *   GET  /jobs/<id>               -> { status, progressPct, message }
 *   GET  /jobs/<id>/frame.jpg     reference frame, from corners_needed on
 *   POST /jobs/<id>/corners       { frontLeft: [nx, ny], ... } -> { ok: true }
 *   GET  /jobs/<id>/analysis.json once status is "done"
 */
import type { Point } from "./letterbox";
import type { CourtCell } from "./types";

export const JOB_STATUSES = [
  "queued",
  "preparing",
  "corners_needed",
  "analyzing",
  "done",
  "error",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobState {
  status: JobStatus;
  /** 0..100, or null when the server cannot estimate this phase. */
  progressPct: number | null;
  message: string | null;
}

/**
 * The order the picker asks for corners, and the order the endpoint documents.
 * Front = the front-wall end of the court.
 */
export const CORNER_ORDER: readonly CourtCell[] = [
  "frontLeft",
  "frontRight",
  "backLeft",
  "backRight",
];

/** Normalized against frame.jpg, origin top-left. Values MAY fall outside 0..1. */
export type CourtCorners = Record<CourtCell, Point>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJobStatus(value: unknown): JobStatus | null {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value)
    ? (value as JobStatus)
    : null;
}

/**
 * Narrow a `GET /jobs/<id>` body. An unreadable status is fatal (the flow has
 * no idea what to show next), but a junk `progressPct` or `message` just goes
 * missing — the UI already has an indeterminate state for exactly that.
 */
export function parseJobState(value: unknown): JobState | null {
  if (!isRecord(value)) return null;
  const status = asJobStatus(value.status);
  if (status === null) return null;
  const raw = value.progressPct;
  const progressPct =
    typeof raw === "number" && Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : null;
  const message = typeof value.message === "string" && value.message.length > 0 ? value.message : null;
  return { status, progressPct, message };
}

/** Narrow a `POST /jobs` body down to its one useful field. */
export function parseJobId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.jobId === "string" && value.jobId.length > 0 ? value.jobId : null;
}

/** The server's error bodies are `{ error: "..." }`; anything else is unknown. */
export function parseServerError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.error === "string" && value.error.length > 0 ? value.error : null;
}
