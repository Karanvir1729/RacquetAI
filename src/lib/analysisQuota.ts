/**
 * How many analyses of the user's OWN videos have been completed — the meter
 * behind the free tier. A tiny versioned JSON file in the documents sandbox,
 * the same sync sidecar pattern as onboarding.ts, and total in the same way:
 * an unreadable file reads as zero, never a throw.
 *
 * Lives in src/lib because two features touch it (docs/01 rule 2):
 * features/analysis increments it where an analysis is persisted,
 * features/recording reads it to gate the import card.
 *
 * A monotonic counter, NOT a count of `<imp-id>.analysis.json` files on disk.
 * The free tier is "your first three analyses", a consumption allowance —
 * counting sidecars would refund the allowance on every delete, which is a
 * one-tap bypass of the whole paywall. Recording, the Library and the bundled
 * demo never touch this file: the demo is read-only sample data that was never
 * anybody's video, so it must not spend anybody's allowance.
 */
import { File, Paths } from "expo-file-system";

import type { EntitlementState } from "./purchases";

/** Analyses of the user's own footage granted before a subscription is needed. */
export const FREE_ANALYSIS_LIMIT = 3;

const FILE_NAME = "analysis-quota.json";

function quotaFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/**
 * Pure: narrow a persisted quota file to a used-count, or null. Rejects
 * negatives and non-integers rather than trusting a hand-edited file.
 */
export function parseQuotaFile(raw: string): number | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.v !== 1) return null;
  const used = record.used;
  if (typeof used !== "number" || !Number.isInteger(used) || used < 0) return null;
  return used;
}

/** Completed analyses of the user's own videos. Zero when unset/unreadable. */
export function readFreeAnalysesUsed(): number {
  try {
    const file = quotaFile();
    if (!file.exists) return 0;
    return parseQuotaFile(file.textSync()) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count one completed analysis. Called only where an analysis is actually
 * persisted, so a failed or abandoned import costs the user nothing.
 *
 * Silent on disk error: losing a tick means one extra free analysis, which is
 * a far smaller problem than throwing on the success path of a flow the user
 * just waited minutes for.
 */
export function recordFreeAnalysisUsed(): void {
  try {
    const used = readFreeAnalysesUsed();
    const file = quotaFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ v: 1, used: used + 1 }));
  } catch {
    // See above — never let the meter break the flow it is measuring.
  }
}

/** Pure: free analyses still available, clamped to 0..FREE_ANALYSIS_LIMIT. */
export function remainingFreeAnalyses(used: number): number {
  if (!Number.isFinite(used)) return FREE_ANALYSIS_LIMIT;
  return Math.max(0, Math.min(FREE_ANALYSIS_LIMIT, FREE_ANALYSIS_LIMIT - Math.max(0, used)));
}

/**
 * Pure: may a new analysis start?
 *
 * FAIL OPEN on "unknown". If the SDK is missing, the API key is absent, or the
 * store call failed, the app cannot prove the user is unsubscribed — and
 * blocking someone we cannot verify means locking a paying subscriber out of
 * the thing they paid for. Only a confident "free" that has spent the
 * allowance is ever refused.
 */
export function canStartAnalysis(entitlement: EntitlementState, used: number): boolean {
  if (entitlement === "pro" || entitlement === "unknown") return true;
  return remainingFreeAnalyses(used) > 0;
}

/**
 * Pure: the free-tier counter shown on the import card, or null when there is
 * nothing honest to say. Only a verified "free" user gets a number — telling
 * an unverified user they have "2 left" while nothing is being enforced is a
 * promise the app has no intention of keeping, and a subscriber should see
 * nothing at all.
 */
export function freeAnalysesLabel(entitlement: EntitlementState, used: number): string | null {
  if (entitlement !== "free") return null;
  const remaining = remainingFreeAnalyses(used);
  if (remaining === 0) return "Free analyses used";
  return `${remaining} free ${remaining === 1 ? "analysis" : "analyses"} left`;
}
