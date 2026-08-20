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
import { AppState, type AppStateStatus } from "react-native";
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

/** Tell every subscriber. One bad listener must not stop the others. */
function notify(subscribers: Set<() => void>): void {
  for (const listener of subscribers) {
    try {
      listener();
    } catch {
      // Swallowed on purpose — see above.
    }
  }
}

function setEntitlement(next: EntitlementState): void {
  if (next === entitlement) return;
  entitlement = next;
  notify(listeners);
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
const configListeners = new Set<() => void>();

/** True once the SDK loaded AND a key was found. False = unconfigured. */
export function isSubscriptionConfigured(): boolean {
  return configured;
}

/**
 * Watch the configured flag. It flips at most once per launch — from the root
 * layout's effect — but that happens AFTER the first frame, so any screen that
 * mounts in between has to be told rather than left holding a stale `false`.
 */
export function subscribeConfigured(listener: () => void): () => void {
  configListeners.add(listener);
  return () => configListeners.delete(listener);
}

/**
 * The live configured flag. Read through useSyncExternalStore, not called
 * during render, because a paywall that mounts before configure() runs would
 * otherwise render "purchasing unavailable" permanently: nothing else in its
 * props changes when configuration completes, so nothing would re-render it.
 */
export function useIsSubscriptionConfigured(): boolean {
  return useSyncExternalStore(
    subscribeConfigured,
    isSubscriptionConfigured,
    isSubscriptionConfigured,
  );
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
  // Both singletons are set before anyone is told, so a listener that
  // immediately calls loadPackages() finds a usable SDK.
  notify(configListeners);
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

/**
 * Bind the store to the signed-in user so a subscription follows the account,
 * not the device. Called when a session appears. A no-op — and never throws —
 * when purchases are unconfigured or the SDK predates logIn (Expo Go, a build
 * without the pod, the injected test doubles). Re-reads the entitlement after,
 * because logIn returns the newly-identified user's CustomerInfo.
 */
export async function identifyUser(userId: string): Promise<EntitlementState> {
  const active = activeSdk();
  if (active !== null && typeof active.logIn === "function") {
    try {
      await active.logIn(userId);
    } catch {
      // A failed identify leaves the anonymous app-user in place; refresh()
      // still reports whatever entitlement that user has. Never blocks sign-in.
    }
  }
  return refresh();
}

/**
 * Return the store to a fresh anonymous app-user on sign-out, so the next
 * account on a shared or resold phone cannot inherit the previous user's Pro.
 * A no-op — and never throws — when unconfigured or on an SDK without logOut
 * (RevenueCat also rejects logOut for an already-anonymous user; swallowed).
 */
export async function forgetUser(): Promise<EntitlementState> {
  const active = activeSdk();
  if (active !== null && typeof active.logOut === "function") {
    try {
      await active.logOut();
    } catch {
      // Best effort; refresh() re-reads whatever user is now active.
    }
  }
  return refresh();
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

/**
 * Re-read the entitlement whenever the app returns to the foreground.
 *
 * Subscribing, cancelling and expiring all happen OUTSIDE this app — in
 * Settings › Subscriptions, or on another device — and that trip backgrounds
 * RacquetIQ without ever unfocusing the screen the user left, so a focus effect
 * never fires on the way back. Without this, a subscription bought in Settings
 * stays invisible (and a cancelled one stays honoured) until a relaunch.
 *
 * Never awaited and never throws: refresh() resolves to "unknown" on any
 * failure, and "unknown" blocks nobody.
 */
export function useForegroundEntitlementRefresh(): void {
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      // Unconfigured builds have nothing to ask; refresh() would only rewrite
      // the "unknown" that is already there.
      if (state === "active" && isSubscriptionConfigured()) void refresh();
    };
    try {
      const subscription = AppState.addEventListener("change", onChange);
      return () => {
        try {
          subscription.remove();
        } catch {
          // A host without a real AppState (tests, web): nothing to detach.
        }
      };
    } catch {
      // AppState unavailable — the focus effects below still cover navigation.
      return undefined;
    }
  }, []);
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
  // Subscribed to, not sampled: configure() runs in the root layout's effect,
  // which can land after this screen's first render.
  const purchasingAvailable = useIsSubscriptionConfigured();
  const [firstReadDone, setFirstReadDone] = useState(refreshedOnce);

  useForegroundEntitlementRefresh();

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

  // The gate is on this card, so it must also notice a subscription bought (or
  // cancelled) while the app was in the background — focus alone misses that.
  useForegroundEntitlementRefresh();

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
  configListeners.clear();
}
