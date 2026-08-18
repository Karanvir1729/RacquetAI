/**
 * Render smoke test for the paywall, in JS (React.createElement, no JSX) so it
 * matches the suite's `*.test.ts` pattern.
 *
 * This app lost six TestFlight builds to screens that threw on mount, so the
 * bar for the one screen that touches a native purchase SDK is: it renders in
 * EVERY state — including with no props at all, which is the unconfigured
 * build — and the strings App Review looks for are actually on it.
 *
 * `react-test-renderer` is a hard dependency of jest-expo, so this needs no new
 * package. Only the two modules that need a host — safe-area insets and the
 * router — are mocked; everything else is the real component.
 */
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PaywallScreen } from "../PaywallScreen";
import { MONTHLY_PLAN, subscribeLabel, YEARLY_PLAN } from "../paywallCopy";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaView: "SafeAreaView",
}));

jest.mock("expo-router", () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

/** Every string rendered anywhere in the tree, flattened. */
function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function render(props: Parameters<typeof PaywallScreen>[0] = {}): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(PaywallScreen, props));
  });
  return tree;
}

/** Tap the control with this accessibility label and let its promise settle. */
async function press(tree: ReactTestRenderer, label: string): Promise<void> {
  const [node] = tree.root.findAll(
    (instance) =>
      instance.props.accessibilityLabel === label && typeof instance.props.onPress === "function",
  );
  await act(async () => {
    node.props.onPress();
  });
}

describe("the paywall renders in every state", () => {
  it.each([
    ["no props at all — the unconfigured build", {}],
    ["entitlement unknown", { entitlement: "unknown" as const }],
    ["free", { entitlement: "free" as const, purchase: jest.fn(), restorePurchases: jest.fn() }],
    ["already subscribed", { entitlement: "pro" as const }],
    ["still loading", { loading: true }],
    ["store explicitly unavailable", { purchasingAvailable: false, purchase: jest.fn() }],
  ])("mounts with %s", (_label, props) => {
    const tree = render(props);
    expect(tree.toJSON()).not.toBeNull();
    act(() => tree.unmount());
  });
});

describe("what App Review has to be able to see", () => {
  let rendered = "";
  beforeAll(() => {
    rendered = textOf(
      render({ entitlement: "free", purchase: jest.fn(), restorePurchases: jest.fn() }),
    );
  });

  it.each([
    ["the monthly price", MONTHLY_PLAN.priceLabel],
    ["the monthly duration", MONTHLY_PLAN.periodLabel],
    ["the annual price", YEARLY_PLAN.priceLabel],
    ["the annual duration", YEARLY_PLAN.periodLabel],
    ["the restore button", "Restore purchases"],
    ["the auto-renewal disclosure", "auto-renewable subscription"],
    ["the Apple ID charge statement", "charged to your Apple ID"],
    ["the 24-hour cancellation window", "24 hours before the end"],
    ["the Terms link", "Terms of Use"],
    ["the Privacy Policy link", "Privacy Policy"],
    ["a way out", "Not now"],
  ])("shows %s", (_label, needle) => {
    expect(rendered).toContain(needle);
  });
});

describe("the unconfigured build", () => {
  it("explains that buying is unavailable instead of offering a dead button", () => {
    const rendered = textOf(render({}));
    expect(rendered).toContain("isn't available in this build");
    expect(rendered).not.toContain("Subscribe —");
    // The restore button still has to exist — Apple rejects without it.
    expect(rendered).toContain("Restore purchases");
  });

  it("never claims the user is subscribed when the entitlement is unknown", () => {
    expect(textOf(render({ entitlement: "unknown" }))).not.toContain("You're subscribed");
  });
});

describe("the subscribed state", () => {
  it("drops the sales pitch and the plan picker", () => {
    const rendered = textOf(render({ entitlement: "pro", purchase: jest.fn() }));
    expect(rendered).toContain("You're subscribed");
    expect(rendered).not.toContain("Subscribe —");
  });
});

describe("buying", () => {
  it("buys the selected plan and surfaces a failure in words", async () => {
    const purchase = jest.fn().mockRejectedValue(new Error("Your card was declined"));
    const tree = render({ entitlement: "free", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    expect(purchase).toHaveBeenCalledWith(YEARLY_PLAN.id);
    expect(textOf(tree)).toContain("Your card was declined");
  });

  it("says nothing when the user cancels the App Store sheet", async () => {
    const purchase = jest.fn().mockRejectedValue({ userCancelled: true });
    const tree = render({ entitlement: "free", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    // Cancelling is not an error — an alert on top of a deliberate dismissal
    // reads as a bug, and the offer is still on screen to try again.
    expect(textOf(tree)).not.toContain("couldn't be completed");
    expect(textOf(tree)).toContain(subscribeLabel(YEARLY_PLAN));
  });
});

describe("restoring", () => {
  it("reports honestly when there is nothing to restore", async () => {
    const restorePurchases = jest.fn().mockResolvedValue(false);
    const tree = render({ entitlement: "free", purchase: jest.fn(), restorePurchases });
    await press(tree, "Restore purchases");
    expect(restorePurchases).toHaveBeenCalled();
    expect(textOf(tree)).toContain("No active RacquetIQ Pro subscription");
  });

  it("surfaces a restore failure rather than swallowing it", async () => {
    const restorePurchases = jest.fn().mockRejectedValue(new Error("offline"));
    const tree = render({ entitlement: "free", purchase: jest.fn(), restorePurchases });
    await press(tree, "Restore purchases");
    expect(textOf(tree)).toContain("offline");
  });
});
