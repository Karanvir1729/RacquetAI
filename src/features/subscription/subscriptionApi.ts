/**
 * The narrow slice of the subscription API the paywall needs, plus the
 * narrowing that makes calling it safe.
 *
 * This file deliberately does NOT import src/lib/subscription.ts. The paywall
 * takes purchase/restore as props (the route wires that module in), so the
 * screen renders in a build where the store module is missing, unconfigured, or
 * a shape ahead of this one — which is the whole point of a screen whose job is
 * to stay usable when the store is not.
 *
 * Behind those props is RevenueCat's native SDK, so every value that comes back
 * is narrowed from `unknown` and every call is wrapped — the deviceClient.ts
 * rule. A rejected promise or a surprise payload has to become a sentence on
 * screen, never a crash, and never a claim that the user was charged.
 */

/** Verified entitlement. "unknown" = could not be checked — never block on it. */
export type EntitlementState = "unknown" | "free" | "pro";

export type PurchaseOutcome =
  | { status: "purchased" }
  /** User dismissed the App Store sheet. Show nothing — they know they cancelled. */
  | { status: "cancelled" }
  /** No RevenueCat key / SDK in this build: buying is impossible, not broken. */
  | { status: "unavailable" }
  | { status: "failed"; message: string };

export type RestoreOutcome =
  | { status: "restored" }
  | { status: "none" }
  /** Finished, but the API did not say whether anything was restored. */
  | { status: "completed" }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/** Buy a product by its App Store id. Resolves with whatever the store module returns. */
export type PurchaseFn = (productId: string) => Promise<unknown>;

export type RestoreFn = () => Promise<unknown>;

const PURCHASE_FAILED = "The purchase couldn't be completed. Your Apple ID has not been charged.";
const RESTORE_FAILED = "Couldn't reach the App Store to restore your purchases. Try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A user-dismissed purchase sheet, however the SDK spells it. */
function looksCancelled(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // `userCancelled` is RevenueCat's flag on both the error and the result.
  return value.userCancelled === true || value.cancelled === true;
}

/** Non-empty trimmed message off an Error or an error-shaped record. */
function messageOf(value: unknown): string | null {
  const raw = value instanceof Error ? value.message : isRecord(value) ? value.message : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Wrap a RAW error (a rejection, an SDK code) in copy written for the user. */
function failed(base: string, detail: string | null): { status: "failed"; message: string } {
  return { status: "failed", message: detail === null ? base : `${base} (${detail})` };
}

/**
 * A result that already carries a sentence written for the user — lib/
 * subscription.ts returns `{status:"failed", message}` with copy of its own —
 * so show that verbatim instead of nesting it inside a second apology.
 */
function reported(base: string, value: unknown): { status: "failed"; message: string } {
  return { status: "failed", message: messageOf(value) ?? base };
}

/**
 * Narrow whatever `purchase()` resolved with.
 *
 * The default for an unrecognised value is "purchased", not "failed", because
 * the resolve-means-success convention is the common one and the ENTITLEMENT is
 * the source of truth for what the user actually owns — the paywall only uses
 * this outcome to decide whether to show an error. Guessing "failed" here would
 * put a false error in front of someone who just paid; guessing "purchased"
 * merely stops talking, and the entitlement state settles the screen.
 */
export function narrowPurchaseOutcome(value: unknown): PurchaseOutcome {
  if (value === false) return { status: "cancelled" };
  if (looksCancelled(value)) return { status: "cancelled" };
  if (isRecord(value)) {
    const status = value.status;
    if (status === "cancelled" || status === "purchased" || status === "unavailable") {
      return { status };
    }
    if (status === "failed" || status === "error") return reported(PURCHASE_FAILED, value);
    if (value.error !== undefined && value.error !== null) {
      return failed(PURCHASE_FAILED, messageOf(value.error));
    }
  }
  return { status: "purchased" };
}

/** Narrow a rejection from `purchase()`. A cancel is a rejection in RevenueCat. */
export function purchaseOutcomeFromError(error: unknown): PurchaseOutcome {
  if (looksCancelled(error)) return { status: "cancelled" };
  return failed(PURCHASE_FAILED, messageOf(error));
}

/**
 * Narrow whatever `restorePurchases()` resolved with. Unlike a purchase, an
 * unrecognised value means "completed" rather than "restored": telling someone
 * their subscription is back when it may not be is the one lie a restore button
 * must never tell.
 */
export function narrowRestoreOutcome(value: unknown): RestoreOutcome {
  if (value === true || value === "pro" || value === "restored") return { status: "restored" };
  if (value === false || value === "free" || value === "none") return { status: "none" };
  if (isRecord(value)) {
    const status = value.status;
    if (status === "restored" || status === "none" || status === "unavailable") return { status };
    if (status === "failed" || status === "error") return reported(RESTORE_FAILED, value);
    if (value.entitlement === "pro" || value.pro === true || value.isActive === true) {
      return { status: "restored" };
    }
    if (value.entitlement === "free" || value.pro === false || value.isActive === false) {
      return { status: "none" };
    }
  }
  return { status: "completed" };
}

export function restoreOutcomeFromError(error: unknown): RestoreOutcome {
  return failed(RESTORE_FAILED, messageOf(error));
}

/** Call purchase() and turn ANY result — value, rejection, junk — into an outcome. */
export async function runPurchase(
  purchase: PurchaseFn,
  productId: string,
): Promise<PurchaseOutcome> {
  try {
    // Awaited inside the try so a synchronous throw is caught too.
    return narrowPurchaseOutcome(await purchase(productId));
  } catch (error) {
    return purchaseOutcomeFromError(error);
  }
}

export async function runRestore(restorePurchases: RestoreFn): Promise<RestoreOutcome> {
  try {
    return narrowRestoreOutcome(await restorePurchases());
  } catch (error) {
    return restoreOutcomeFromError(error);
  }
}
