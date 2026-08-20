/**
 * The subscription API. The case that matters most is the UNCONFIGURED one —
 * no RevenueCat key exists yet, so that is the state this app ships in: every
 * call has to return a well-defined result, the entitlement has to stay
 * "unknown", and nothing may throw.
 *
 * expo-router is mocked down to the one hook the module imports, so the store
 * logic runs on Node without the router.
 */
import {
  configure,
  forgetUser,
  getEntitlement,
  identifyUser,
  isSubscriptionConfigured,
  loadPackages,
  purchase,
  readApiKey,
  refresh,
  resetSubscriptionForTests,
  restorePurchases,
  subscribeEntitlement,
  UNAVAILABLE_MESSAGE,
  type SubscriptionPackage,
} from "../subscription";

jest.mock("expo-router", () => ({ useFocusEffect: () => {} }));

jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  class MockFile {
    private readonly key: string;
    constructor(_parent: unknown, name: string) {
      this.key = name;
    }
    get exists(): boolean {
      return store.has(this.key);
    }
    create(): void {
      if (!store.has(this.key)) store.set(this.key, "");
    }
    write(text: string): void {
      store.set(this.key, text);
    }
    textSync(): string {
      const text = store.get(this.key);
      if (text === undefined) throw new Error(`no such file: ${this.key}`);
      return text;
    }
  }
  return { File: MockFile, Paths: { document: "/documents" } };
});

const API_KEY = "appl_TESTKEY";

const PRO_INFO = { entitlements: { active: { pro: { isActive: true } } } };
const FREE_INFO = { entitlements: { active: {} } };

/** A fake SDK whose every call is overridable per test. */
function fakeSdk(overrides: Record<string, unknown> = {}) {
  return {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(() => Promise.resolve(FREE_INFO)),
    getOfferings: jest.fn(() => Promise.resolve({ current: null })),
    getProducts: jest.fn(() => Promise.resolve([])),
    purchasePackage: jest.fn(() => Promise.resolve({ customerInfo: PRO_INFO })),
    purchaseStoreProduct: jest.fn(() => Promise.resolve({ customerInfo: PRO_INFO })),
    restorePurchases: jest.fn(() => Promise.resolve(FREE_INFO)),
    addCustomerInfoUpdateListener: jest.fn(),
    ...overrides,
  };
}

const YEARLY_PACKAGE: SubscriptionPackage = {
  id: "$rc_annual",
  productId: "racquetiq_pro_yearly",
  priceString: "$79.99",
  title: "RacketIQ Pro (Yearly)",
  period: "yearly",
  fromOffering: true,
  native: { identifier: "$rc_annual" },
};

beforeEach(() => resetSubscriptionForTests());

describe("the unconfigured state (no RevenueCat key — how the app ships today)", () => {
  it("reports itself unconfigured and never claims a subscription", () => {
    expect(configure(null, null)).toBe(false);
    expect(isSubscriptionConfigured()).toBe(false);
    expect(getEntitlement()).toBe("unknown");
  });

  it("is unconfigured with a key but no SDK in the binary", () => {
    expect(configure(null, API_KEY)).toBe(false);
    expect(isSubscriptionConfigured()).toBe(false);
  });

  it("is unconfigured with an SDK but no key", () => {
    const sdk = fakeSdk();
    expect(configure(sdk, null)).toBe(false);
    expect(sdk.configure).not.toHaveBeenCalled();
  });

  it("refreshes to 'unknown' rather than rejecting", async () => {
    await expect(refresh()).resolves.toBe("unknown");
    expect(getEntitlement()).toBe("unknown");
  });

  it("answers 'unavailable' — not an exception — for every store call", async () => {
    await expect(purchase("racquetiq_pro_yearly")).resolves.toEqual({
      status: "unavailable",
      message: UNAVAILABLE_MESSAGE,
    });
    await expect(restorePurchases()).resolves.toEqual({
      status: "unavailable",
      message: UNAVAILABLE_MESSAGE,
    });
    await expect(loadPackages()).resolves.toEqual({
      status: "unavailable",
      message: UNAVAILABLE_MESSAGE,
    });
  });

  it("explains that nothing is locked", () => {
    expect(UNAVAILABLE_MESSAGE).toMatch(/Nothing is locked/);
  });

  it("finds no API key in this environment", () => {
    expect(readApiKey()).toBeNull();
  });
});

describe("configure", () => {
  it("hands the key to the SDK and registers the update listener", () => {
    const sdk = fakeSdk();
    expect(configure(sdk, API_KEY)).toBe(true);
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: API_KEY });
    expect(sdk.addCustomerInfoUpdateListener).toHaveBeenCalled();
    expect(isSubscriptionConfigured()).toBe(true);
  });

  it("is idempotent — a second call does not re-configure the SDK", () => {
    const sdk = fakeSdk();
    configure(sdk, API_KEY);
    expect(configure(sdk, API_KEY)).toBe(true);
    expect(sdk.configure).toHaveBeenCalledTimes(1);
  });

  it("stays unconfigured, and does not throw, when the SDK throws", () => {
    const sdk = fakeSdk({
      configure: () => {
        throw new Error("native module missing");
      },
    });
    expect(configure(sdk, API_KEY)).toBe(false);
    expect(isSubscriptionConfigured()).toBe(false);
  });

  it("survives an SDK with no update listener API", () => {
    const sdk = fakeSdk({ addCustomerInfoUpdateListener: undefined });
    expect(configure(sdk, API_KEY)).toBe(true);
  });

  it("pushes listener updates into the entitlement store", () => {
    // A renewal, an expiry, or a purchase made outside this session.
    const captured: { notify: ((info: unknown) => void) | null } = { notify: null };
    const sdk = fakeSdk({
      addCustomerInfoUpdateListener: (listener: (info: unknown) => void) => {
        captured.notify = listener;
      },
    });
    configure(sdk, API_KEY);
    expect(captured.notify).not.toBeNull();
    captured.notify?.(PRO_INFO);
    expect(getEntitlement()).toBe("pro");
  });
});

describe("refresh", () => {
  it("reads the entitlement and notifies subscribers once", async () => {
    const sdk = fakeSdk({ getCustomerInfo: () => Promise.resolve(PRO_INFO) });
    configure(sdk, API_KEY);
    const seen = jest.fn();
    subscribeEntitlement(seen);
    await expect(refresh()).resolves.toBe("pro");
    expect(getEntitlement()).toBe("pro");
    expect(seen).toHaveBeenCalledTimes(1);
    // Same value again: no churn.
    await refresh();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("reads a verified free user as free", async () => {
    configure(fakeSdk(), API_KEY);
    await expect(refresh()).resolves.toBe("free");
  });

  it("falls back to 'unknown' when the store call rejects", async () => {
    const sdk = fakeSdk({ getCustomerInfo: () => Promise.reject(new Error("offline")) });
    configure(sdk, API_KEY);
    await expect(refresh()).resolves.toBe("unknown");
  });

  it("falls back to 'unknown' on a payload it cannot read", async () => {
    const sdk = fakeSdk({ getCustomerInfo: () => Promise.resolve("surprise") });
    configure(sdk, API_KEY);
    await expect(refresh()).resolves.toBe("unknown");
  });

  it("stops notifying an unsubscribed listener", async () => {
    const sdk = fakeSdk({ getCustomerInfo: () => Promise.resolve(PRO_INFO) });
    configure(sdk, API_KEY);
    const seen = jest.fn();
    subscribeEntitlement(seen)();
    await refresh();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("purchase", () => {
  it("buys a package through purchasePackage and adopts the new entitlement", async () => {
    const sdk = fakeSdk();
    configure(sdk, API_KEY);
    await expect(purchase(YEARLY_PACKAGE)).resolves.toEqual({
      status: "purchased",
      entitlement: "pro",
    });
    expect(sdk.purchasePackage).toHaveBeenCalledWith(YEARLY_PACKAGE.native);
    expect(getEntitlement()).toBe("pro");
  });

  it("buys a product id by resolving it through getProducts first", async () => {
    const product = { identifier: "racquetiq_pro_monthly", priceString: "$9.99", title: "Monthly" };
    const sdk = fakeSdk({ getProducts: jest.fn(() => Promise.resolve([product])) });
    configure(sdk, API_KEY);
    await expect(purchase("racquetiq_pro_monthly")).resolves.toEqual({
      status: "purchased",
      entitlement: "pro",
    });
    expect(sdk.getProducts).toHaveBeenCalledWith(["racquetiq_pro_monthly"]);
    expect(sdk.purchaseStoreProduct).toHaveBeenCalledWith(product);
  });

  it("treats a user cancellation as a normal outcome, not an error", async () => {
    const sdk = fakeSdk({
      purchasePackage: () => Promise.reject({ userCancelled: true, message: "cancelled" }),
    });
    configure(sdk, API_KEY);
    await expect(purchase(YEARLY_PACKAGE)).resolves.toEqual({ status: "cancelled" });
  });

  it("recognises a cancellation by error code too", async () => {
    const sdk = fakeSdk({ purchasePackage: () => Promise.reject({ code: "1" }) });
    configure(sdk, API_KEY);
    await expect(purchase(YEARLY_PACKAGE)).resolves.toEqual({ status: "cancelled" });
  });

  it("returns a written message on a real failure", async () => {
    const sdk = fakeSdk({
      purchasePackage: () => Promise.reject({ code: "2", message: "Payment declined." }),
    });
    configure(sdk, API_KEY);
    await expect(purchase(YEARLY_PACKAGE)).resolves.toEqual({
      status: "failed",
      message: "Payment declined.",
    });
  });

  it("fails cleanly when the product id cannot be found in the store", async () => {
    const sdk = fakeSdk();
    configure(sdk, API_KEY);
    const result = await purchase("racquetiq_pro_yearly");
    expect(result.status).toBe("failed");
    expect(sdk.purchaseStoreProduct).not.toHaveBeenCalled();
  });

  it("reports the entitlement it could read back, even if it is not pro", async () => {
    // A completed purchase whose customerInfo we cannot parse must not be
    // reported as a failure — the user was charged.
    const sdk = fakeSdk({ purchasePackage: () => Promise.resolve({ customerInfo: "???" }) });
    configure(sdk, API_KEY);
    await expect(purchase(YEARLY_PACKAGE)).resolves.toEqual({
      status: "purchased",
      entitlement: "unknown",
    });
  });
});

describe("restorePurchases", () => {
  it("restores an active subscription", async () => {
    const sdk = fakeSdk({ restorePurchases: () => Promise.resolve(PRO_INFO) });
    configure(sdk, API_KEY);
    await expect(restorePurchases()).resolves.toEqual({ status: "restored" });
    expect(getEntitlement()).toBe("pro");
  });

  it("says 'none' when the store answered and there is nothing to restore", async () => {
    configure(fakeSdk(), API_KEY);
    await expect(restorePurchases()).resolves.toEqual({ status: "none" });
    expect(getEntitlement()).toBe("free");
  });

  it("does not claim 'none' when the answer was unreadable", async () => {
    const sdk = fakeSdk({ restorePurchases: () => Promise.resolve(12345) });
    configure(sdk, API_KEY);
    const result = await restorePurchases();
    expect(result.status).toBe("failed");
    // Unverifiable, so the user is still not blocked anywhere.
    expect(getEntitlement()).toBe("unknown");
  });

  it("returns a failure message when the store call rejects", async () => {
    const sdk = fakeSdk({ restorePurchases: () => Promise.reject(new Error("offline")) });
    configure(sdk, API_KEY);
    await expect(restorePurchases()).resolves.toEqual({ status: "failed", message: "offline" });
  });
});

describe("loadPackages", () => {
  it("prefers the configured offering", async () => {
    const product = { identifier: "racquetiq_pro_yearly", priceString: "$79.99", title: "Yearly" };
    const sdk = fakeSdk({
      getOfferings: () =>
        Promise.resolve({
          current: {
            availablePackages: [{ identifier: "$rc_annual", packageType: "ANNUAL", product }],
          },
        }),
    });
    configure(sdk, API_KEY);
    const result = await loadPackages();
    expect(result).toEqual({
      status: "ok",
      packages: [expect.objectContaining({ productId: "racquetiq_pro_yearly", period: "yearly" })],
    });
    expect(sdk.getProducts).not.toHaveBeenCalled();
  });

  it("falls back to the two product ids when no offering is configured", async () => {
    const monthly = { identifier: "racquetiq_pro_monthly", priceString: "$9.99", title: "Monthly" };
    const yearly = { identifier: "racquetiq_pro_yearly", priceString: "$79.99", title: "Yearly" };
    const sdk = fakeSdk({ getProducts: jest.fn(() => Promise.resolve([monthly, yearly])) });
    configure(sdk, API_KEY);
    const result = await loadPackages();
    expect(sdk.getProducts).toHaveBeenCalledWith(["racquetiq_pro_monthly", "racquetiq_pro_yearly"]);
    expect(result.status).toBe("ok");
  });

  it("falls back to products when getOfferings rejects", async () => {
    const yearly = { identifier: "racquetiq_pro_yearly", priceString: "$79.99", title: "Yearly" };
    const sdk = fakeSdk({
      getOfferings: () => Promise.reject(new Error("no network")),
      getProducts: jest.fn(() => Promise.resolve([yearly])),
    });
    configure(sdk, API_KEY);
    expect((await loadPackages()).status).toBe("ok");
  });

  it("fails cleanly when the store returns nothing at all", async () => {
    configure(fakeSdk(), API_KEY);
    const result = await loadPackages();
    expect(result.status).toBe("failed");
  });
});

/**
 * Binding the store to the signed-in account. Without this a subscription
 * belongs to the DEVICE: user A buys Pro, signs out, user B signs in on the
 * same phone and inherits it. The SDK members are optional on purpose (old
 * SDKs, Expo Go, the doubles above), so every path here must also survive
 * their absence rather than throwing on the sign-in path.
 */
describe("binding the entitlement to an account", () => {
  it("identifies the user with the store and re-reads their entitlement", async () => {
    const logIn = jest.fn(() => Promise.resolve({}));
    const sdk = fakeSdk({ logIn, getCustomerInfo: () => Promise.resolve(PRO_INFO) });
    configure(sdk, API_KEY);

    expect(await identifyUser("user-abc")).toBe("pro");
    expect(logIn).toHaveBeenCalledWith("user-abc");
  });

  it("logs out so the next account cannot inherit the previous user's Pro", async () => {
    const logOut = jest.fn(() => Promise.resolve({}));
    const sdk = fakeSdk({ logOut, getCustomerInfo: () => Promise.resolve(FREE_INFO) });
    configure(sdk, API_KEY);

    expect(await forgetUser()).toBe("free");
    expect(logOut).toHaveBeenCalled();
  });

  it("still reports the entitlement when the SDK has no logIn/logOut", async () => {
    // fakeSdk() deliberately omits both — the shape an older SDK presents.
    const sdk = fakeSdk({ getCustomerInfo: () => Promise.resolve(PRO_INFO) });
    configure(sdk, API_KEY);

    expect(await identifyUser("user-abc")).toBe("pro");
    expect(await forgetUser()).toBe("pro");
  });

  it("does not let a rejected logIn break sign-in", async () => {
    const sdk = fakeSdk({
      logIn: () => Promise.reject(new Error("network")),
      getCustomerInfo: () => Promise.resolve(FREE_INFO),
    });
    configure(sdk, API_KEY);

    // Resolves to a real entitlement rather than rejecting.
    expect(await identifyUser("user-abc")).toBe("free");
  });

  it("is a safe no-op when purchases are unconfigured", async () => {
    expect(await identifyUser("user-abc")).toBe("unknown");
    expect(await forgetUser()).toBe("unknown");
    expect(getEntitlement()).toBe("unknown");
  });
});
