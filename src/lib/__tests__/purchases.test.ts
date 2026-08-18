/**
 * The RevenueCat boundary. The load path is the one that killed six TestFlight
 * builds — a native module missing from the binary throwing at import time —
 * so it is tested the same way deviceClient's loader is: every shape of
 * failure has to come back as `null`, never a throw.
 *
 * The entitlement narrowing is tested for its three-way answer in particular:
 * an unreadable payload must be "unknown", never "free", because "free" would
 * paywall a paying subscriber over an SDK shape change.
 */
import {
  billingPeriod,
  customerInfoFromResult,
  entitlementFromCustomerInfo,
  isUserCancelled,
  loadPurchases,
  packageFromOfferingPackage,
  packageFromStoreProduct,
  packagesFromOfferings,
  packagesFromProducts,
  PRO_MONTHLY_PRODUCT_ID,
  PRO_PRODUCT_IDS,
  PRO_YEARLY_PRODUCT_ID,
  purchaseErrorMessage,
} from "../purchases";

/** A value satisfying every call the app makes. */
const workingSdk = {
  configure: () => {},
  getCustomerInfo: () => Promise.resolve({}),
  getOfferings: () => Promise.resolve({}),
  getProducts: () => Promise.resolve([]),
  purchasePackage: () => Promise.resolve({}),
  purchaseStoreProduct: () => Promise.resolve({}),
  restorePurchases: () => Promise.resolve({}),
};

describe("product identifiers", () => {
  it("match the products created in App Store Connect", () => {
    expect(PRO_MONTHLY_PRODUCT_ID).toBe("racquetiq_pro_monthly");
    expect(PRO_YEARLY_PRODUCT_ID).toBe("racquetiq_pro_yearly");
    expect([...PRO_PRODUCT_IDS]).toEqual(["racquetiq_pro_monthly", "racquetiq_pro_yearly"]);
  });
});

describe("loadPurchases", () => {
  it("is null when the module cannot be required (no pod in the binary)", () => {
    expect(
      loadPurchases(() => {
        throw new Error("Cannot find module 'react-native-purchases'");
      }),
    ).toBeNull();
  });

  it("is null when reading the SDK's API throws (native half missing)", () => {
    // The build-15 failure mode: the export resolves natives lazily behind
    // getters, so merely reading a property throws. Swallow that too.
    const lazyExploding = {
      get configure(): unknown {
        throw new Error("Cannot find native module 'RNPurchases'");
      },
    };
    expect(loadPurchases(() => ({ default: lazyExploding }))).toBeNull();
    expect(loadPurchases(() => lazyExploding)).toBeNull();
  });

  it("loads via the default export, which is a class of statics", () => {
    class Purchases {}
    Object.assign(Purchases, workingSdk);
    expect(loadPurchases(() => ({ default: Purchases }))).not.toBeNull();
  });

  it("loads when the API sits on the module record itself", () => {
    expect(loadPurchases(() => workingSdk)).not.toBeNull();
  });

  it("is null when the loaded module misses part of the API", () => {
    expect(loadPurchases(() => ({}))).toBeNull();
    expect(loadPurchases(() => null)).toBeNull();
    expect(loadPurchases(() => undefined)).toBeNull();
    expect(loadPurchases(() => "not a module")).toBeNull();
    expect(loadPurchases(() => ({ ...workingSdk, restorePurchases: undefined }))).toBeNull();
  });
});

describe("entitlementFromCustomerInfo", () => {
  it("is pro when the entitlement is active", () => {
    expect(
      entitlementFromCustomerInfo({ entitlements: { active: { pro: { isActive: true } } } }),
    ).toBe("pro");
  });

  it("is pro even when the active entry carries no isActive flag", () => {
    // Presence in `active` is already RevenueCat's own verdict.
    expect(entitlementFromCustomerInfo({ entitlements: { active: { pro: {} } } })).toBe("pro");
  });

  it("is free when the payload is readable and pro is absent", () => {
    expect(entitlementFromCustomerInfo({ entitlements: { active: {} } })).toBe("free");
    expect(entitlementFromCustomerInfo({ entitlements: { active: { other: {} } } })).toBe("free");
  });

  it("is free when the entry is explicitly inactive", () => {
    expect(
      entitlementFromCustomerInfo({ entitlements: { active: { pro: { isActive: false } } } }),
    ).toBe("free");
  });

  it("is UNKNOWN, never free, for anything it cannot read", () => {
    expect(entitlementFromCustomerInfo(null)).toBe("unknown");
    expect(entitlementFromCustomerInfo(undefined)).toBe("unknown");
    expect(entitlementFromCustomerInfo("pro")).toBe("unknown");
    expect(entitlementFromCustomerInfo([])).toBe("unknown");
    expect(entitlementFromCustomerInfo({})).toBe("unknown");
    expect(entitlementFromCustomerInfo({ entitlements: {} })).toBe("unknown");
    expect(entitlementFromCustomerInfo({ entitlements: { active: null } })).toBe("unknown");
    expect(entitlementFromCustomerInfo({ entitlements: "yes" })).toBe("unknown");
  });

  it("honours a custom entitlement identifier", () => {
    const info = { entitlements: { active: { premium: {} } } };
    expect(entitlementFromCustomerInfo(info, "premium")).toBe("pro");
    expect(entitlementFromCustomerInfo(info, "pro")).toBe("free");
  });
});

describe("isUserCancelled", () => {
  it("recognises the flag and the error code", () => {
    expect(isUserCancelled({ userCancelled: true })).toBe(true);
    expect(isUserCancelled({ code: "1" })).toBe(true);
    expect(isUserCancelled({ code: 1 })).toBe(true);
  });

  it("does not mistake a real failure for a cancellation", () => {
    expect(isUserCancelled({ userCancelled: false, code: "2" })).toBe(false);
    expect(isUserCancelled(new Error("network down"))).toBe(false);
    expect(isUserCancelled(null)).toBe(false);
    expect(isUserCancelled("cancelled")).toBe(false);
  });
});

describe("purchaseErrorMessage", () => {
  it("prefers the SDK's own message", () => {
    expect(purchaseErrorMessage({ message: "  Product not available.  " })).toBe(
      "Product not available.",
    );
  });

  it("falls back to the readable code, then to a written sentence", () => {
    expect(purchaseErrorMessage({ userInfo: { readableErrorCode: "STORE_PROBLEM" } })).toBe(
      "STORE_PROBLEM",
    );
    expect(purchaseErrorMessage(null)).toMatch(/App Store/);
    expect(purchaseErrorMessage({ message: "   " })).toMatch(/App Store/);
  });
});

describe("billingPeriod", () => {
  it("reads the package type first", () => {
    expect(billingPeriod("MONTHLY", "racquetiq_pro_yearly")).toBe("monthly");
    expect(billingPeriod("ANNUAL", "whatever")).toBe("yearly");
    expect(billingPeriod("annual", "whatever")).toBe("yearly");
  });

  it("falls back to the product id when there is no package type", () => {
    expect(billingPeriod(undefined, "racquetiq_pro_monthly")).toBe("monthly");
    expect(billingPeriod(undefined, "racquetiq_pro_yearly")).toBe("yearly");
    expect(billingPeriod(null, "com.x.annual_plan")).toBe("yearly");
  });

  it("is 'other' when neither says anything useful", () => {
    expect(billingPeriod(undefined, "racquetiq_pro")).toBe("other");
    expect(billingPeriod(42, "sku_1")).toBe("other");
  });
});

describe("package narrowing", () => {
  const product = {
    identifier: PRO_YEARLY_PRODUCT_ID,
    title: "RacquetIQ Pro (Yearly)",
    priceString: "$79.99",
    price: 79.99,
  };

  it("flattens an offering package and keeps the SDK object for the purchase", () => {
    const pkg = { identifier: "$rc_annual", packageType: "ANNUAL", product };
    const narrowed = packageFromOfferingPackage(pkg);
    expect(narrowed).toEqual({
      id: "$rc_annual",
      productId: PRO_YEARLY_PRODUCT_ID,
      priceString: "$79.99",
      title: "RacquetIQ Pro (Yearly)",
      period: "yearly",
      fromOffering: true,
      native: pkg,
    });
    // Handed straight back to purchasePackage — never reconstructed.
    expect(narrowed?.native).toBe(pkg);
  });

  it("flattens a bare store product for the getProducts fallback", () => {
    const narrowed = packageFromStoreProduct(product);
    expect(narrowed?.fromOffering).toBe(false);
    expect(narrowed?.productId).toBe(PRO_YEARLY_PRODUCT_ID);
    expect(narrowed?.native).toBe(product);
  });

  it("never invents a price, and falls back to the id for a missing title", () => {
    const narrowed = packageFromStoreProduct({ identifier: "racquetiq_pro_monthly" });
    expect(narrowed?.priceString).toBe("");
    expect(narrowed?.title).toBe("racquetiq_pro_monthly");
  });

  it("rejects anything without a usable product identifier", () => {
    expect(packageFromStoreProduct(null)).toBeNull();
    expect(packageFromStoreProduct({})).toBeNull();
    expect(packageFromStoreProduct({ identifier: "" })).toBeNull();
    expect(packageFromOfferingPackage({ identifier: "$rc_annual" })).toBeNull();
    expect(packageFromOfferingPackage("nope")).toBeNull();
  });

  it("reads the current offering and drops unreadable entries", () => {
    const packages = packagesFromOfferings({
      current: {
        availablePackages: [{ identifier: "$rc_annual", packageType: "ANNUAL", product }, null, {}],
      },
    });
    expect(packages).toHaveLength(1);
    expect(packages[0].period).toBe("yearly");
  });

  it("returns an empty list when no offering is configured", () => {
    // Legitimate: the dashboard may have products but no offering. The caller
    // then fetches the two product ids directly.
    expect(packagesFromOfferings({ current: null })).toEqual([]);
    expect(packagesFromOfferings({})).toEqual([]);
    expect(packagesFromOfferings(null)).toEqual([]);
    expect(packagesFromOfferings({ current: { availablePackages: "nope" } })).toEqual([]);
  });

  it("narrows a getProducts array, dropping junk", () => {
    expect(packagesFromProducts([product, null, 7])).toHaveLength(1);
    expect(packagesFromProducts(null)).toEqual([]);
  });
});

describe("customerInfoFromResult", () => {
  it("unwraps a purchase result and passes a restore result through", () => {
    const info = { entitlements: { active: {} } };
    expect(customerInfoFromResult({ customerInfo: info, productIdentifier: "x" })).toBe(info);
    expect(customerInfoFromResult(info)).toBe(info);
    expect(customerInfoFromResult(null)).toBeNull();
  });
});
