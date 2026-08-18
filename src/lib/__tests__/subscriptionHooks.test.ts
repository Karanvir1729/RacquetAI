/**
 * The two ways the subscription state changes WITHOUT the user touching the
 * screen it is displayed on, both of which used to be invisible:
 *
 *  1. configure() runs in the root layout's effect, after the first frame. A
 *     screen mounted before it must be told when it completes — sampling
 *     isSubscriptionConfigured() during render pins "purchases unavailable" on
 *     for the life of that screen.
 *  2. Subscribing, cancelling and expiring happen in Settings › Subscriptions,
 *     i.e. while this app is backgrounded. Coming back never unfocuses
 *     anything, so a focus effect does not fire and the entitlement goes stale.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, create } from "react-test-renderer";

import {
  configure,
  getEntitlement,
  resetSubscriptionForTests,
  useAnalysisQuota,
  useSubscriptionStatus,
  type AnalysisQuota,
  type SubscriptionStatus,
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

/** A fake SDK whose CustomerInfo can be swapped between calls, as a real one's is. */
function fakeSdk(initial: unknown = FREE_INFO) {
  const state = { info: initial };
  return {
    state,
    sdk: {
      configure: jest.fn(),
      getCustomerInfo: jest.fn(() => Promise.resolve(state.info)),
      getOfferings: jest.fn(() => Promise.resolve({ current: null })),
      getProducts: jest.fn(() => Promise.resolve([])),
      purchasePackage: jest.fn(() => Promise.resolve({})),
      purchaseStoreProduct: jest.fn(() => Promise.resolve({})),
      restorePurchases: jest.fn(() => Promise.resolve(state.info)),
      addCustomerInfoUpdateListener: jest.fn(),
    },
  };
}

/** Every AppState "change" handler registered while mounted. */
let handlers: ((state: AppStateStatus) => void)[] = [];
let addEventListener: jest.SpyInstance;

beforeEach(() => {
  resetSubscriptionForTests();
  handlers = [];
  addEventListener = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event: string, handler: (state: AppStateStatus) => void) => {
      if (event === "change") handlers.push(handler);
      return { remove: jest.fn() } as never;
    });
});

afterEach(() => addEventListener.mockRestore());

/** Drive the app back to the foreground and let the refresh settle. */
async function foreground(state: AppStateStatus = "active"): Promise<void> {
  await act(async () => {
    for (const handler of handlers) handler(state);
  });
}

function statusProbe(seen: jest.Mock) {
  function Probe() {
    seen(useSubscriptionStatus());
    return null;
  }
  return createElement(Probe);
}

function quotaProbe(seen: jest.Mock) {
  function Probe() {
    seen(useAnalysisQuota());
    return null;
  }
  return createElement(Probe);
}

function latest<T>(seen: jest.Mock): T {
  return seen.mock.calls[seen.mock.calls.length - 1][0] as T;
}

describe("purchasingAvailable is reactive, not sampled once", () => {
  it("flips to true when configure() lands after the screen has mounted", async () => {
    const seen = jest.fn();
    const { sdk } = fakeSdk();
    // The paywall mounts first — this is the real cold-start order, since
    // configure() runs in the root layout's effect.
    await act(async () => {
      create(statusProbe(seen));
    });
    expect(latest<SubscriptionStatus>(seen).purchasingAvailable).toBe(false);

    await act(async () => {
      configure(sdk, API_KEY);
    });

    // Without a subscription to the configured flag this stays false forever:
    // nothing else in the screen's props changes to force a re-render.
    expect(latest<SubscriptionStatus>(seen).purchasingAvailable).toBe(true);
  });

  it("reads the entitlement once configuration arrives", async () => {
    const seen = jest.fn();
    const { sdk } = fakeSdk(PRO_INFO);
    await act(async () => {
      create(statusProbe(seen));
    });
    await act(async () => {
      configure(sdk, API_KEY);
    });
    expect(sdk.getCustomerInfo).toHaveBeenCalled();
    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("pro");
  });

  it("is never 'loading' in an unconfigured build — there is nothing to wait for", async () => {
    const seen = jest.fn();
    await act(async () => {
      create(statusProbe(seen));
    });
    expect(latest<SubscriptionStatus>(seen)).toEqual({
      entitlement: "unknown",
      loading: false,
      purchasingAvailable: false,
    });
  });
});

describe("returning from the background", () => {
  it("re-reads an entitlement that changed while the app was away", async () => {
    const seen = jest.fn();
    const { sdk, state } = fakeSdk(FREE_INFO);
    configure(sdk, API_KEY);
    await act(async () => {
      create(statusProbe(seen));
    });
    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("free");

    // The user subscribed in Settings › Subscriptions and came back.
    state.info = PRO_INFO;
    await foreground();

    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("pro");
  });

  it("notices a lapsed subscription too", async () => {
    const seen = jest.fn();
    const { sdk, state } = fakeSdk(PRO_INFO);
    configure(sdk, API_KEY);
    await act(async () => {
      create(statusProbe(seen));
    });
    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("pro");

    state.info = FREE_INFO;
    await foreground();

    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("free");
  });

  it("re-checks the gate on the import card as well", async () => {
    const seen = jest.fn();
    const { sdk, state } = fakeSdk(FREE_INFO);
    configure(sdk, API_KEY);
    await act(async () => {
      create(quotaProbe(seen));
    });
    // useFocusEffect is mocked to nothing here on purpose: this asserts the
    // foreground path ALONE, which is the trip a focus effect cannot see.
    expect(latest<AnalysisQuota>(seen).entitlement).toBe("unknown");

    state.info = PRO_INFO;
    await foreground();

    expect(latest<AnalysisQuota>(seen).entitlement).toBe("pro");
    expect(latest<AnalysisQuota>(seen).canStart).toBe(true);
  });

  it("ignores a trip to the background", async () => {
    const seen = jest.fn();
    const { sdk } = fakeSdk(FREE_INFO);
    configure(sdk, API_KEY);
    await act(async () => {
      create(statusProbe(seen));
    });
    const readsAfterMount = sdk.getCustomerInfo.mock.calls.length;

    await foreground("background");
    await foreground("inactive");

    expect(sdk.getCustomerInfo).toHaveBeenCalledTimes(readsAfterMount);
  });

  it("asks nothing of an unconfigured build, and does not throw", async () => {
    const seen = jest.fn();
    await act(async () => {
      create(statusProbe(seen));
    });
    await foreground();
    // Still the fail-open state, still no crash.
    expect(getEntitlement()).toBe("unknown");
    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("unknown");
  });

  it("survives an AppState that cannot register a listener", async () => {
    addEventListener.mockImplementation(() => {
      throw new Error("no AppState in this host");
    });
    const seen = jest.fn();
    const { sdk } = fakeSdk(PRO_INFO);
    configure(sdk, API_KEY);
    await act(async () => {
      create(statusProbe(seen));
    });
    // Degraded, not dead: the mount refresh still ran.
    expect(latest<SubscriptionStatus>(seen).entitlement).toBe("pro");
  });
});
