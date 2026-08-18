/**
 * The free-tier GATE, end to end through the wiring rather than through the
 * arithmetic alone (analysisQuota.test.ts already covers canStartAnalysis).
 *
 * What is actually at risk here is the join: quota file on disk → entitlement
 * from the store → useAnalysisQuota → this card's decision to open the picker
 * or push /paywall. Every one of those is real in this test; only the three
 * hosts are faked — the filesystem, the router and the image picker.
 *
 * The case that must never regress is the FAIL-OPEN one: an entitlement we
 * could not verify has to let the user through, because blocking someone we
 * cannot prove is unsubscribed means locking a paying subscriber out.
 *
 * JS (React.createElement, no JSX) to match the suite's `*.test.ts` pattern.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { configure, refresh, resetSubscriptionForTests } from "@/lib/subscription";

import { ImportAnalysisCard } from "../ImportAnalysisCard";

// Hoisted above the imports by babel-jest, so the modules under test get these.
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
  return { File: MockFile, Paths: { document: "/documents" }, __store: store };
});

// useFocusEffect stands in as a mount effect: the card is being rendered fresh,
// which is exactly what a tab focus does to it.
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect } = require("react") as typeof import("react");
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      useEffect(callback, [callback]);
    },
  };
});

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: [] })),
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
}));

const { __store: store } = jest.requireMock("expo-file-system") as {
  __store: Map<string, string>;
};
const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
const picker = jest.requireMock("expo-image-picker") as {
  launchImageLibraryAsync: jest.Mock;
};

const PRO_INFO = { entitlements: { active: { pro: { isActive: true } } } };
const FREE_INFO = { entitlements: { active: {} } };

/** A fake RevenueCat SDK that answers getCustomerInfo with `info`. */
function sdkReturning(info: unknown) {
  return {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(() => Promise.resolve(info)),
    getOfferings: jest.fn(() => Promise.resolve({ current: null })),
    getProducts: jest.fn(() => Promise.resolve([])),
    purchasePackage: jest.fn(() => Promise.resolve({})),
    purchaseStoreProduct: jest.fn(() => Promise.resolve({})),
    restorePurchases: jest.fn(() => Promise.resolve(info)),
    addCustomerInfoUpdateListener: jest.fn(),
  };
}

/** Put `used` analyses on disk, exactly as recordFreeAnalysisUsed writes them. */
function setAnalysesUsed(used: number): void {
  store.set("analysis-quota.json", JSON.stringify({ v: 1, used }));
}

/**
 * Mount the card with the entitlement the store would report. `null` = leave
 * the app unconfigured, which is how it ships today and the source of the
 * "unknown" entitlement.
 */
async function mountCard(customerInfo: unknown | null): Promise<ReactTestRenderer> {
  if (customerInfo !== null) {
    configure(sdkReturning(customerInfo), "appl_TESTKEY");
    await refresh();
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(ImportAnalysisCard));
  });
  return tree;
}

/** Press the card and let the picker promise settle. */
async function pressCard(tree: ReactTestRenderer): Promise<void> {
  const [node] = tree.root.findAll(
    (instance) =>
      typeof instance.props.accessibilityLabel === "string" &&
      typeof instance.props.onPress === "function",
  );
  await act(async () => {
    node.props.onPress();
  });
}

function labelOf(tree: ReactTestRenderer): string {
  const [node] = tree.root.findAll(
    (instance) => typeof instance.props.accessibilityLabel === "string",
  );
  return node.props.accessibilityLabel as string;
}

beforeEach(() => {
  resetSubscriptionForTests();
  store.clear();
  router.push.mockClear();
  picker.launchImageLibraryAsync.mockClear();
});

describe("the gate is closed only for a verified free user out of analyses", () => {
  it("routes to the paywall instead of opening the picker", async () => {
    setAnalysesUsed(3);
    const tree = await mountCard(FREE_INFO);
    await pressCard(tree);
    expect(router.push).toHaveBeenCalledWith("/paywall");
    // The order matters: never ask someone to choose a video and only then
    // refuse to analyse it.
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it("stays closed once the allowance has been overshot", async () => {
    setAnalysesUsed(9);
    const tree = await mountCard(FREE_INFO);
    await pressCard(tree);
    expect(router.push).toHaveBeenCalledWith("/paywall");
  });

  it("says so on the card itself, before the tap", async () => {
    setAnalysesUsed(3);
    const tree = await mountCard(FREE_INFO);
    expect(labelOf(tree)).toContain("Subscribe");
    expect(JSON.stringify(tree.toJSON())).toContain("Free analyses used");
  });
});

describe("the gate fails open", () => {
  it("opens the picker when the entitlement could not be verified", async () => {
    // Unconfigured build (no RevenueCat key) + allowance spent: "unknown" must
    // NOT block, or an unreadable store call paywalls a paying subscriber.
    setAnalysesUsed(3);
    const tree = await mountCard(null);
    await pressCard(tree);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalledWith("/paywall");
  });

  it("opens the picker when the store answered with an unreadable payload", async () => {
    // Configured, but getCustomerInfo returned something we cannot parse —
    // refresh() lands on "unknown", and "unknown" never blocks.
    setAnalysesUsed(3);
    const tree = await mountCard("surprise");
    await pressCard(tree);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalledWith("/paywall");
  });

  it("shows no free-analysis count it cannot enforce", async () => {
    setAnalysesUsed(1);
    const tree = await mountCard(null);
    expect(JSON.stringify(tree.toJSON())).not.toContain("free analyses left");
  });
});

describe("the gate is open for everyone else", () => {
  it("opens the picker for a subscriber with the allowance long spent", async () => {
    setAnalysesUsed(42);
    const tree = await mountCard(PRO_INFO);
    await pressCard(tree);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalledWith("/paywall");
  });

  it("opens the picker for a free user with analyses left, and counts them", async () => {
    setAnalysesUsed(2);
    const tree = await mountCard(FREE_INFO);
    expect(JSON.stringify(tree.toJSON())).toContain("1 free analysis left");
    await pressCard(tree);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalledWith("/paywall");
  });

  it("opens the picker on a first run with nothing on disk", async () => {
    const tree = await mountCard(FREE_INFO);
    await pressCard(tree);
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it("hands the picked video to the import route", async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///match.mov" }],
    });
    const tree = await mountCard(FREE_INFO);
    await pressCard(tree);
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/import-analysis",
      params: { videoUri: "file:///match.mov" },
    });
  });
});
