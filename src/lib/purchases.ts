/**
 * The react-native-purchases (RevenueCat) boundary — billing's answer to
 * features/analysis/deviceClient.ts. Nothing above this file ever touches the
 * SDK: it loads the module, and it narrows every value that comes back out of
 * it from `unknown` into the small shapes the app actually uses.
 *
 * The module is loaded with `require` inside try/catch — NEVER a top-level
 * static import. Six TestFlight builds died because a native module missing
 * from the binary threw AT IMPORT TIME, which is fatal in release; RevenueCat
 * has exactly the same failure mode in Expo Go and in any build made before
 * the pod was added. A failed load degrades to `null` (→ the UNCONFIGURED
 * state, which never blocks the user), not a crash. The whole body is guarded,
 * not just the require: the SDK's default export is a class whose statics can
 * throw on access when the native half is absent.
 *
 * Deliberately no `import type` from the package either — the app's view of a
 * customer info / offering / product payload is defined here, so a major SDK
 * version bump can only break this file.
 */

/** What the app knows about the user's access. "unknown" = could not verify. */
export type EntitlementState = "unknown" | "free" | "pro";

/** RevenueCat entitlement identifier configured for the paid tier. */
export const PRO_ENTITLEMENT_ID = "pro";

/** App Store Connect product ids (subscription group "RacketIQ Pro"). */
export const PRO_MONTHLY_PRODUCT_ID = "racquetiq_pro_monthly";
export const PRO_YEARLY_PRODUCT_ID = "racquetiq_pro_yearly";

/** Both paid products, monthly first — the order the paywall falls back to. */
export const PRO_PRODUCT_IDS: readonly string[] = [PRO_MONTHLY_PRODUCT_ID, PRO_YEARLY_PRODUCT_ID];

/**
 * The slice of the SDK this app calls. Returns are `unknown` because the SDK
 * is a boundary — every result is narrowed by the helpers below before use.
 */
export interface PurchasesSdk {
  configure(configuration: { apiKey: string }): void;
  getCustomerInfo(): Promise<unknown>;
  getOfferings(): Promise<unknown>;
  getProducts(productIdentifiers: string[]): Promise<unknown>;
  purchasePackage(aPackage: unknown): Promise<unknown>;
  purchaseStoreProduct(product: unknown): Promise<unknown>;
  restorePurchases(): Promise<unknown>;
  /** Present since v4, but treated as optional — it is a nice-to-have. */
  addCustomerInfoUpdateListener?(listener: (info: unknown) => void): void;
  /**
   * Bind / unbind the store to a stable app-user id, so a subscription follows
   * the signed-in account rather than the device. Optional: absent on old SDKs
   * and on the module shapes the tests inject, so every caller guards on type.
   */
  logIn?(appUserID: string): Promise<unknown>;
  logOut?(): Promise<unknown>;
}

export type PurchasesLoader = () => unknown;

// Must be a runtime require inside try/catch — a static import would crash any
// binary built without the RevenueCat pod, at import time, before any of our
// code runs.
const defaultLoader: PurchasesLoader = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-purchases") as unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function narrowSdk(value: unknown): PurchasesSdk | null {
  // A class with static methods is a function, not a record — check callability
  // on the value itself rather than requiring an object.
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" && typeof value !== "function") return null;
  const candidate = value as Record<string, unknown>;
  const required = [
    "configure",
    "getCustomerInfo",
    "getOfferings",
    "getProducts",
    "purchasePackage",
    "purchaseStoreProduct",
    "restorePurchases",
  ] as const;
  for (const name of required) {
    if (typeof candidate[name] !== "function") return null;
  }
  return candidate as unknown as PurchasesSdk;
}

/**
 * The RevenueCat SDK, or null when it cannot be loaded (Expo Go, a build
 * without the pod) or does not expose the calls this app makes. Accepts either
 * the `default` export (the SDK's own shape) or the module record itself.
 * Never throws.
 */
export function loadPurchases(loader: PurchasesLoader = defaultLoader): PurchasesSdk | null {
  try {
    const exported = loader();
    const viaDefault =
      isRecord(exported) || typeof exported === "function"
        ? narrowSdk((exported as Record<string, unknown>).default)
        : null;
    return viaDefault ?? narrowSdk(exported);
  } catch {
    return null;
  }
}

/**
 * Pure: read the entitlement out of a CustomerInfo payload.
 *
 * The three-way answer is the whole point. A payload we can read and that has
 * no active "pro" is a confident "free"; a payload we CANNOT read is "unknown"
 * and callers must fail open. Mapping unreadable to "free" would paywall a
 * paying subscriber over an SDK shape change, which is the one outcome worth
 * more than every free analysis this app will ever give away.
 */
export function entitlementFromCustomerInfo(
  info: unknown,
  entitlementId: string = PRO_ENTITLEMENT_ID,
): EntitlementState {
  if (!isRecord(info)) return "unknown";
  const entitlements = info.entitlements;
  if (!isRecord(entitlements)) return "unknown";
  const active = entitlements.active;
  if (!isRecord(active)) return "unknown";
  const entry = active[entitlementId];
  if (entry === undefined) return "free";
  // Present in `active` is already the SDK's own verdict; isActive is only
  // consulted to catch an explicit false.
  if (isRecord(entry) && entry.isActive === false) return "free";
  return "pro";
}

/** RevenueCat's PURCHASE_CANCELLED_ERROR. A string in the generated enum. */
const CANCELLED_ERROR_CODE = "1";

/**
 * Pure: did the user back out of the App Store sheet? That is a normal
 * outcome, not a failure, and must never surface as an error message.
 */
export function isUserCancelled(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.userCancelled === true) return true;
  // `code` is a string enum in the SDK, but tolerate the numeric form.
  return error.code === CANCELLED_ERROR_CODE || error.code === 1;
}

/** Pure: the user-facing half of an SDK rejection, never a stack trace. */
export function purchaseErrorMessage(error: unknown): string {
  if (isRecord(error)) {
    const info = error.userInfo;
    const readable = isRecord(info) ? info.readableErrorCode : undefined;
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      return error.message.trim();
    }
    if (typeof readable === "string" && readable.trim().length > 0) return readable.trim();
  }
  return "The App Store could not complete that purchase. Try again.";
}

export type BillingPeriod = "monthly" | "yearly" | "other";

/**
 * One purchasable option, flattened for the paywall. `native` is the SDK's own
 * package/product object, kept opaque and handed straight back to `purchase`
 * so the app never has to reconstruct anything the SDK gave it.
 */
export interface SubscriptionPackage {
  /** Package identifier when it came from an offering, else the product id. */
  id: string;
  productId: string;
  /** Localized, store-formatted — never build a price string by hand. */
  priceString: string;
  title: string;
  period: BillingPeriod;
  /** True when `native` is an offering package rather than a bare product. */
  fromOffering: boolean;
  readonly native: unknown;
}

/** Pure: package type / product id → billing period, for paywall copy. */
export function billingPeriod(packageType: unknown, productId: string): BillingPeriod {
  if (typeof packageType === "string") {
    const upper = packageType.toUpperCase();
    if (upper === "MONTHLY") return "monthly";
    if (upper === "ANNUAL" || upper === "YEARLY") return "yearly";
  }
  const id = productId.toLowerCase();
  if (id.includes("year") || id.includes("annual")) return "yearly";
  if (id.includes("month")) return "monthly";
  return "other";
}

function narrowProduct(product: unknown): { id: string; price: string; title: string } | null {
  if (!isRecord(product)) return null;
  const { identifier, priceString, title } = product;
  if (typeof identifier !== "string" || identifier.length === 0) return null;
  return {
    id: identifier,
    // A missing price is not fatal — the button still works, it just cannot
    // promise a number. Never invent one.
    price: typeof priceString === "string" && priceString.length > 0 ? priceString : "",
    title: typeof title === "string" && title.length > 0 ? title : identifier,
  };
}

/** Pure: a bare StoreProduct (the getProducts path) → SubscriptionPackage. */
export function packageFromStoreProduct(product: unknown): SubscriptionPackage | null {
  const narrowed = narrowProduct(product);
  if (narrowed === null) return null;
  return {
    id: narrowed.id,
    productId: narrowed.id,
    priceString: narrowed.price,
    title: narrowed.title,
    period: billingPeriod(undefined, narrowed.id),
    fromOffering: false,
    native: product,
  };
}

/** Pure: one offering package → SubscriptionPackage, or null when unreadable. */
export function packageFromOfferingPackage(value: unknown): SubscriptionPackage | null {
  if (!isRecord(value)) return null;
  const narrowed = narrowProduct(value.product);
  if (narrowed === null) return null;
  const identifier = typeof value.identifier === "string" ? value.identifier : narrowed.id;
  return {
    id: identifier.length > 0 ? identifier : narrowed.id,
    productId: narrowed.id,
    priceString: narrowed.price,
    title: narrowed.title,
    period: billingPeriod(value.packageType, narrowed.id),
    fromOffering: true,
    native: value,
  };
}

/**
 * Pure: the current offering's packages. An empty list is a legitimate answer
 * (no offering configured in the RevenueCat dashboard yet) and the caller
 * falls back to fetching the two product ids directly.
 */
export function packagesFromOfferings(offerings: unknown): SubscriptionPackage[] {
  if (!isRecord(offerings)) return [];
  const current = offerings.current;
  if (!isRecord(current)) return [];
  const available = current.availablePackages;
  if (!Array.isArray(available)) return [];
  const packages: SubscriptionPackage[] = [];
  for (const entry of available) {
    const narrowed = packageFromOfferingPackage(entry);
    if (narrowed !== null) packages.push(narrowed);
  }
  return packages;
}

/** Pure: a getProducts result → SubscriptionPackages, unreadable ones dropped. */
export function packagesFromProducts(products: unknown): SubscriptionPackage[] {
  if (!Array.isArray(products)) return [];
  const packages: SubscriptionPackage[] = [];
  for (const entry of products) {
    const narrowed = packageFromStoreProduct(entry);
    if (narrowed !== null) packages.push(narrowed);
  }
  return packages;
}

/**
 * Pure: pull the CustomerInfo out of a purchase/restore result, which is
 * either `{ customerInfo }` (purchasePackage) or the info itself
 * (restorePurchases).
 */
export function customerInfoFromResult(result: unknown): unknown {
  if (isRecord(result) && "customerInfo" in result) return result.customerInfo;
  return result;
}
