/**
 * The analysis-server HTTP contract — pure and unit-tested (no Expo imports).
 *
 * One server, five endpoints (see docs: upload → preparing → corners_needed →
 * analyzing → done):
 *
 *   POST /jobs                    multipart "video"        → {jobId}
 *   GET  /jobs/{id}               → {status, progressPct, message}
 *   GET  /jobs/{id}/frame.jpg     mid-video reference frame
 *   POST /jobs/{id}/corners       {frontLeft:[nx,ny], …} normalized 0..1
 *   GET  /jobs/{id}/analysis.json schemaVersion-1 MatchAnalysis
 *
 * Everything a response body feeds into the app is narrowed from `unknown`
 * here (the metadata.ts pattern) — a misbehaving server yields null, never a
 * crash. URL building and payload shaping live here too so the network layer
 * (importClient.ts) contains no string-munging worth testing.
 */
import { COURT_CELLS, type CourtCell } from "./types";

/**
 * Where the server engine points when nothing is stored (changeable from the
 * Account tab's Analysis engine card). Must be a host a phone can actually
 * reach (localhost is a dev-machine-only address and left the fallback dead
 * on device). HTTPS since the Caddy sidecar landed — the plain :8082 port
 * still exists for builds that predate it.
 */
export const DEFAULT_SERVER_BASE_URL = "https://racquetiq-a7682a.eastus.azurecontainer.io";

/** The five server-side job states, in flow order. */
export const JOB_STATUSES = [
  "queued",
  "preparing",
  "corners_needed",
  "analyzing",
  "done",
  "error",
] as const;

export type JobStatusValue = (typeof JOB_STATUSES)[number];

export interface JobStatus {
  status: JobStatusValue;
  /** 0..100 when the server reports stage progress, else null. */
  progressPct: number | null;
  message: string | null;
}

/** A normalized 0..1 point on the reference frame (origin top-left). */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** The four floor corners; keys intentionally shared with the placement grid. */
export type CourtCorners = Record<CourtCell, NormalizedPoint>;

/** Tap order the product asks for: Front left → Front right → Back left → Back right. */
export const CORNER_ORDER: readonly CourtCell[] = COURT_CELLS;

/**
 * Clean a user-typed base URL: trim, default a missing scheme to http://,
 * strip trailing slashes. Returns null when nothing usable remains — callers
 * keep the previous value rather than persisting garbage.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  // scheme://host[:port][/path] with no whitespace — light validation, LAN IPs
  // welcome; the host check keeps degenerate input ("http://") from slipping
  // through as a hostname.
  const match = /^https?:\/\/([^\s/]+)(\/\S*)?$/i.exec(withScheme);
  if (match === null || !/^[A-Za-z0-9._-]+(:\d{1,5})?$/.test(match[1])) return null;
  return withScheme;
}

export function jobsUrl(baseUrl: string): string {
  return `${baseUrl}/jobs`;
}

export function jobUrl(baseUrl: string, jobId: string): string {
  return `${jobsUrl(baseUrl)}/${encodeURIComponent(jobId)}`;
}

export function frameUrl(baseUrl: string, jobId: string): string {
  return `${jobUrl(baseUrl, jobId)}/frame.jpg`;
}

export function cornersUrl(baseUrl: string, jobId: string): string {
  return `${jobUrl(baseUrl, jobId)}/corners`;
}

export function analysisUrl(baseUrl: string, jobId: string): string {
  return `${jobUrl(baseUrl, jobId)}/analysis.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Body of POST /jobs → the created job id, or null on any malformation. */
export function parseJobCreated(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.jobId !== "string" || data.jobId.length === 0) return null;
  return data.jobId;
}

/** Body of GET /jobs/{id} → a JobStatus, or null when the shape is unusable. */
export function parseJobStatus(raw: string): JobStatus | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const status = data.status;
  if (typeof status !== "string" || !(JOB_STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  // Progress and message are advisory — anything malformed degrades to null.
  const progressPct =
    typeof data.progressPct === "number" && Number.isFinite(data.progressPct)
      ? Math.min(100, Math.max(0, data.progressPct))
      : null;
  const message = typeof data.message === "string" && data.message.length > 0 ? data.message : null;
  return { status: status as JobStatusValue, progressPct, message };
}

/** Round a normalized coordinate for the wire — sub-pixel precision at 4 dp. */
function roundCoord(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

/** JSON body for POST /jobs/{id}/corners: {"frontLeft":[nx,ny], …}. */
export function cornersBody(corners: CourtCorners): string {
  const payload: Record<string, [number, number]> = {};
  for (const cell of CORNER_ORDER) {
    const point = corners[cell];
    payload[cell] = [roundCoord(point.x), roundCoord(point.y)];
  }
  return JSON.stringify(payload);
}

/** MIME type for an upload from its file extension; the server takes mp4/mov. */
export function videoMimeType(uri: string): string {
  return /\.mov$/i.test(uri.split("?")[0].split("#")[0]) ? "video/quicktime" : "video/mp4";
}

/**
 * The picked file's basename, reduced to header-safe ASCII for the raw
 * upload's X-Filename header. Falls back to "upload.mp4" when the URI has no
 * usable name.
 */
export function uploadFileName(uri: string): string {
  const base = uri.split("?")[0].split("#")[0].split("/").pop() ?? "";
  const safe = decodeURIComponentSafe(base).replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "upload.mp4";
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
