/**
 * The app's subscription API — the only module the UI imports. It owns the
 * entitlement state, the RevenueCat calls, and the free-analysis quota
 * (re-exported from analysisQuota.ts so consumers have one import), while
 * purchases.ts owns the SDK boundary itself.
 *
 * THE UNCONFIGURED STATE IS A FIRST-CLASS OUTCOME, not an error. The API key
 * does not exist yet, and even once it does, a build without the pod or a
 * store outage lands here. When the SDK is unavailable the entitlement stays
 * "unknown" and every gate FAILS OPEN — an app that cannot verify a
 * subscription must never withhold what it cannot prove was unpaid. The
 * paywall's buttons say purchasing is unavailable; nothing throws.
 *
 * Entitlement lives in a module-scope store read through useSyncExternalStore
 * rather than a provider: it is one enum, it changes about twice per install,
 * and every screen that cares can subscribe without the root layout growing a
 * context.
 *
 * Over docs/01's ~300-line limit on purpose (rule 5 asks for the reason).
 * Everything below hangs off three module-scope singletons — `sdk`,
 * `configured`, `entitlement` — and splitting store / commerce / hooks apart
 * would mean exporting that mutable state across file boundaries so the other
 * halves could reach it. Trading real encapsulation for a line count is a bad
 * deal; the SDK narrowing and the quota, which genuinely stand alone, already
 * live in their own files.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";

import {
  canStartAnalysis,
  freeAnalysesLabel,
  readFreeAnalysesUsed,
  remainingFreeAnalyses,
} from "./analysisQuota";
import {
  customerInfoFromResult,
  entitlementFromCustomerInfo,
  isUserCancelled,
  loadPurchases,
  packagesFromOfferings,
  packagesFromProducts,
  PRO_PRODUCT_IDS,
  purchaseErrorMessage,
  type EntitlementState,
  type PurchasesSdk,
  type SubscriptionPackage,
} from "./purchases";

export {
  canStartAnalysis,
  freeAnalysesLabel,
  FREE_ANALYSIS_LIMIT,
  readFreeAnalysesUsed,
  recordFreeAnalysisUsed,
  remainingFreeAnalyses,
} from "./analysisQuota";
export {
  PRO_ENTITLEMENT_ID,
  PRO_MONTHLY_PRODUCT_ID,
  PRO_PRODUCT_IDS,
  PRO_YEARLY_PRODUCT_ID,
  type BillingPeriod,
  type EntitlementState,
  type SubscriptionPackage,
} from "./purchases";

/** Shown wherever a purchase cannot even be attempted. */
export const UNAVAILABLE_MESSAGE =
  "In-app purchases aren't available in this build yet. Nothing is locked — you can keep analyzing.";

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------

/**
 * The iOS key, from `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (inlined by Metro at
 * build time) or `extra.revenueCatIosKey` in app.json. Absent is the normal
 * case today, and it means UNCONFIGURED, not broken.
 */
export function readApiKey(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  try {
    // Required lazily and read behind try/catch for the same reason as the SDK
    // itself: config access must not be able to take down a cold start.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constants = require("expo-constants") as unknown;
    const module = constants as { default?: { expoConfig?: { extra?: unknown } } };
    const extra = module.default?.expoConfig?.extra;
    if (typeof extra === "object" && extra !== null) {
      const key = (extra as Record<string, unknown>).revenueCatIosKey;
      if (typeof key === "string" && key.trim().length > 0) return key.trim();
    }
  } catch {
    // No config, no key — the unconfigured path.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entitlement store
// ---------------------------------------------------------------------------

let entitlement: EntitlementState = "unknown";
const listeners = new Set<() => void>();

function setEntitlement(next: EntitlementState): void {
  if (next === entitlement) return;
  entitlement = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One bad subscriber must not stop the others being told.
    }
  }
}

export function getEntitlement(): EntitlementState {
  return entitlement;
}

export function subscribeEntitlement(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

let sdk: PurchasesSdk | null = null;
let configured = false;

/** True once the SDK loaded AND a key was found. False = unconfigured. */
export function isSubscriptionConfigured(): boolean {
  return configured;
}

/**
 * Initialise RevenueCat. Safe to call more than once, and a safe no-op when
 * the SDK or the key is missing. Never throws. Returns whether the app can
 * actually talk to the store, which is also what the paywall keys off. Both
 * dependencies are injectable for tests (the makeImportedAnalysisId pattern).
 */
export function configure(
  loaded: PurchasesSdk | null = loadPurchases(),
  apiKey: string | null = readApiKey(),
): boolean {
  if (configured) return true;
  if (loaded === null || apiKey === null) return false;
  try {
    loaded.configure({ apiKey });
  } catch {
    return false;
  }
  sdk = loaded;
  configured = true;
  // Renewals, expirations and purchases made outside this session arrive here.
  try {
    loaded.addCustomerInfoUpdateListener?.((info) => {
      setEntitlement(entitlementFromCustomerInfo(info));
    });
  } catch {
    // Optional convenience; refresh() still covers every screen that cares.
  }
  return true;
}

/** Test seam + internal accessor: the configured SDK, or null. */
function activeSdk(): PurchasesSdk | null {
  return configured ? sdk : null;
}

/**
 * Re-read the entitlement from the store. Resolves to "unknown" whenever it
 * cannot be verified — unconfigured, offline, or an unreadable payload — and
 * "unknown" never blocks anyone. Never rejects.
 */
export async function refresh(): Promise<EntitlementState> {
  const active = activeSdk();
  if (active === null) {
    setEntitlement("unknown");
    return "unknown";
  }
  let next: EntitlementState;
  try {
    next = entitlementFromCustomerInfo(customerInfoFromResult(await active.getCustomerInfo()));
  } catch {
    next = "unknown";
  }
  setEntitlement(next);
  return next;
}

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

export type PackagesResult =
  | { status: "ok"; packages: SubscriptionPackage[] }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/**
 * What the paywall can sell. Prefers the configured offering; falls back to
 * fetching the two product ids directly, so a dashboard whose offering was
 * never set up still shows real, store-priced buttons.
 */
export async function loadPackages(): Promise<PackagesResult> {
  const active = activeSdk();
  if (active === null) return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
  try {
    const packages = packagesFromOfferings(await active.getOfferings());
    if (packages.length > 0) return { status: "ok", packages };
  } catch {
    // Fall through: the direct product fetch is the better answer anyway.
  }
  try {
    const packages = packagesFromProducts(await active.getProducts([...PRO_PRODUCT_IDS]));
    return packages.length > 0
      ? { status: "ok", packages }
      : { status: "failed", message: "The App Store didn't return any subscriptions. Try again." };
  } catch (error) {
    return { status: "failed", message: purchaseErrorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Purchase / restore
// ---------------------------------------------------------------------------

export type PurchaseResult =
  /** The store completed. `entitlement` is what we could read back afterwards. */
  | { status: "purchased"; entitlement: EntitlementState }
  /** The user backed out of the App Store sheet. A normal outcome. */
  | { status: "cancelled" }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/**
 * Buy a package (preferred — it carries the SDK's own object) or a bare
 * product id. Returns a result; never throws, and never treats a cancellation
 * as an error.
 */
export async function purchase(target: SubscriptionPackage | string): Promise<PurchaseResult> {
  const active = activeSdk();
  if (active === null) return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
  try {
    const chosen = typeof target === "string" ? await resolveProduct(active, target) : target;
    if (chosen === null) {
      return {
        status: "failed",
        message: "That subscription isn't available from the App Store right now.",
      };
    }
    const result = chosen.fromOffering
      ? await active.purchasePackage(chosen.native)
      : await active.purchaseStoreProduct(chosen.native);
    const next = entitlementFromCustomerInfo(customerInfoFromResult(result));
    setEntitlement(next);
    return { status: "purchased", entitlement: next };
  } catch (error) {
    if (isUserCancelled(error)) return { status: "cancelled" };
    return { status: "failed", message: purchaseErrorMessage(error) };
  }
}

async function resolveProduct(
  active: PurchasesSdk,
  productId: string,
): Promise<SubscriptionPackage | null> {
  const packages = packagesFromProducts(await active.getProducts([productId]));
  // EXACT id only. A "close enough" fallback here would charge someone for a
  // plan they did not tap — a $79.99 annual for a $9.99 monthly press — so an
  // unrecognised store response must fail the purchase, not guess at it.
  return packages.find((entry) => entry.productId === productId) ?? null;
}

export type RestoreResult =
  | { status: "restored" }
  /** The store answered, and this Apple ID has no active subscription. */
  | { status: "none" }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

/** Restore purchases. Never throws; the entitlement is updated either way. */
export async function restorePurchases(): Promise<RestoreResult> {
  const active = activeSdk();
  if (active === null) return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
  let next: EntitlementState;
  try {
    next = entitlementFromCustomerInfo(customerInfoFromResult(await active.restorePurchases()));
  } catch (error) {
    return { status: "failed", message: purchaseErrorMessage(error) };
  }
  setEntitlement(next);
  if (next === "pro") return { status: "restored" };
  if (next === "free") return { status: "none" };
  // Answered, but in a shape we could not read. Say so rather than telling the
  // user they own nothing — they are not blocked either way (fail open).
  return {
    status: "failed",
    message: "Couldn't read your purchases from the App Store. Try again.",
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** The live entitlement. Re-renders when a purchase or refresh changes it. */
export function useEntitlement(): EntitlementState {
  return useSyncExternalStore(subscribeEntitlement, getEntitlement, getEntitlement);
}

export interface SubscriptionStatus {
  entitlement: EntitlementState;
  /** True only while the FIRST entitlement read of the session is in flight. */
  loading: boolean;
  /** False when there is no key or no SDK: buying is impossible, not broken. */
  purchasingAvailable: boolean;
}

/** Set once per launch so re-entering the paywall never re-flashes a spinner. */
let refreshedOnce = false;

/**
 * Everything the paywall route needs, so the route stays a thin composition
 * (docs/01 rule 1) instead of growing an effect of its own.
 */
export function useSubscriptionStatus(): SubscriptionStatus {
  const entitlementState = useEntitlement();
  const purchasingAvailable = isSubscriptionConfigured();
  const [firstReadDone, setFirstReadDone] = useState(refreshedOnce);

  useEffect(() => {
    if (!purchasingAvailable) return;
    let active = true;
    void (async () => {
      await refresh(); // never rejects
      refreshedOnce = true;
      if (active) setFirstReadDone(true);
    })();
    return () => {
      active = false;
    };
  }, [purchasingAvailable]);

  return {
    entitlement: entitlementState,
    // Derived, not stored: an unconfigured build is never "loading", it is
    // simply done — there is nothing to wait for.
    loading: purchasingAvailable && !firstReadDone,
    purchasingAvailable,
  };
}

export interface AnalysisQuota {
  entitlement: EntitlementState;
  used: number;
  remaining: number;
  /** False only for a verified free user who has spent the allowance. */
  canStart: boolean;
  /** Short honest caption, or null when there is nothing truthful to show. */
  label: string | null;
}

/**
 * Entitlement + free-analysis count for the import card. The count is re-read
 * on every tab focus (the useRecordings pattern — the filesystem is the source
 * of truth, no cross-screen event plumbing) and the entitlement is refreshed
 * alongside it so a lapsed subscription is noticed without a relaunch.
 */
export function useAnalysisQuota(): AnalysisQuota {
  const entitlementState = useEntitlement();
  const [used, setUsed] = useState(readFreeAnalysesUsed);

  useFocusEffect(
    useCallback(() => {
      setUsed(readFreeAnalysesUsed());
      void refresh();
    }, []),
  );

  return {
    entitlement: entitlementState,
    used,
    remaining: remainingFreeAnalyses(used),
    canStart: canStartAnalysis(entitlementState, used),
    label: freeAnalysesLabel(entitlementState, used),
  };
}

/** Test-only: drop configuration and entitlement back to a cold start. */
export function resetSubscriptionForTests(): void {
  sdk = null;
  configured = false;
  refreshedOnce = false;
  entitlement = "unknown";
  listeners.clear();
}
