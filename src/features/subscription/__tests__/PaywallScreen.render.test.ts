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
import { StyleSheet, type TextStyle } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { colors } from "@/theme/tokens";

import { PaywallScreen } from "../PaywallScreen";
import {
  MONTHLY_PLAN,
  PURCHASE_CONFIRMED,
  PURCHASES_UNAVAILABLE,
  subscribeLabel,
  YEARLY_PLAN,
} from "../paywallCopy";

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

/**
 * The resolved text colour of the first node rendering `needle` — how the test
 * tells an error (danger red) from a notice without reaching into component
 * internals.
 */
function colorOf(tree: ReactTestRenderer, needle: string): unknown {
  const [node] = tree.root.findAll(
    (instance) =>
      typeof instance.props.children === "string" &&
      instance.props.children.includes(needle) &&
      instance.props.style !== undefined,
  );
  if (node === undefined) throw new Error(`no styled text containing: ${needle}`);
  const flat: TextStyle | undefined = StyleSheet.flatten(node.props.style as TextStyle);
  return flat?.color;
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

  /**
   * The charge is real; the entitlement read-back may not survive. A screen
   * that only reacts to the entitlement leaves someone who has just paid
   * looking at the same Subscribe button.
   */
  it("confirms a completed purchase even when the entitlement stays unknown", async () => {
    const purchase = jest.fn().mockResolvedValue({ status: "purchased", entitlement: "unknown" });
    const tree = render({ entitlement: "unknown", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    expect(textOf(tree)).toContain("Purchase complete");
    // And the CTA is gone, so there is no second tap to make.
    expect(textOf(tree)).not.toContain(subscribeLabel(YEARLY_PLAN));
  });

  it("confirms a purchase the store reported with no entitlement at all", async () => {
    // The `{status:"purchased"}` shape, without the entitlement field.
    const purchase = jest.fn().mockResolvedValue({ status: "purchased" });
    const tree = render({ entitlement: "free", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    expect(textOf(tree)).toContain(PURCHASE_CONFIRMED.slice(0, 40));
  });

  it("still offers Restore after a confirmed purchase — the way out of a stuck read", async () => {
    const purchase = jest.fn().mockResolvedValue({ status: "purchased", entitlement: "unknown" });
    const tree = render({ entitlement: "unknown", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    expect(textOf(tree)).toContain("Restore purchases");
  });

  it("does not claim a purchase that failed", async () => {
    const purchase = jest.fn().mockResolvedValue({ status: "failed", message: "Card declined." });
    const tree = render({ entitlement: "free", purchase, restorePurchases: jest.fn() });
    await press(tree, subscribeLabel(YEARLY_PLAN));
    expect(textOf(tree)).not.toContain("Purchase complete");
    expect(textOf(tree)).toContain("Card declined.");
  });
});

describe("an unreachable store", () => {
  /**
   * Same condition, same treatment. "unavailable" is not a fault: nothing was
   * attempted and nothing is locked, so it reads as a notice on BOTH paths —
   * matching the identical sentence the unconfigured build already shows in a
   * plain notice card.
   */
  it("reports an unavailable purchase the same way as an unavailable restore", async () => {
    const buying = render({
      entitlement: "free",
      purchase: jest.fn().mockResolvedValue({ status: "unavailable" }),
      restorePurchases: jest.fn(),
    });
    await press(buying, subscribeLabel(YEARLY_PLAN));

    const restoring = render({
      entitlement: "free",
      purchase: jest.fn(),
      restorePurchases: jest.fn().mockResolvedValue({ status: "unavailable" }),
    });
    await press(restoring, "Restore purchases");

    const needle = PURCHASES_UNAVAILABLE.slice(0, 40);
    expect(textOf(buying)).toContain(needle);
    expect(textOf(restoring)).toContain(needle);
    expect(colorOf(buying, needle)).toBe(colorOf(restoring, needle));
    expect(colorOf(buying, needle)).not.toBe(colors.danger);
  });
});

describe("restoring", () => {
  it("reports honestly when there is nothing to restore", async () => {
    const restorePurchases = jest.fn().mockResolvedValue(false);
    const tree = render({ entitlement: "free", purchase: jest.fn(), restorePurchases });
    await press(tree, "Restore purchases");
    expect(restorePurchases).toHaveBeenCalled();
    expect(textOf(tree)).toContain("No active RacketIQ Pro subscription");
  });

  it("surfaces a restore failure rather than swallowing it", async () => {
    const restorePurchases = jest.fn().mockRejectedValue(new Error("offline"));
    const tree = render({ entitlement: "free", purchase: jest.fn(), restorePurchases });
    await press(tree, "Restore purchases");
    expect(textOf(tree)).toContain("offline");
  });
});
