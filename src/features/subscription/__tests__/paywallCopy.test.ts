/**
 * The paywall's numbers and copy. These are App Review surface: the product
 * ids must match App Store Connect, both durations must carry their price, and
 * the saving must be arithmetic rather than marketing.
 */
import {
  comparisonNote,
  FREE_TIER_NOTE,
  MONTHLY_PLAN,
  PAYWALL_PLANS,
  perMonthNote,
  PRO_BENEFITS,
  RENEWAL_DISCLOSURE,
  restoreMessage,
  savingBadge,
  savingPercent,
  subscribeLabel,
  YEARLY_PLAN,
  type PaywallPlan,
} from "../paywallCopy";

describe("the products match App Store Connect", () => {
  it("uses the exact product ids from the RacketIQ Pro group", () => {
    expect(MONTHLY_PLAN.id).toBe("racquetiq_pro_monthly");
    expect(YEARLY_PLAN.id).toBe("racquetiq_pro_yearly");
  });

  it("prices both plans as listed, with the duration spelled out", () => {
    expect(MONTHLY_PLAN.priceLabel).toBe("$9.99");
    expect(MONTHLY_PLAN.periodLabel).toBe("per month");
    expect(YEARLY_PLAN.priceLabel).toBe("$79.99");
    expect(YEARLY_PLAN.periodLabel).toBe("per year");
  });

  it("offers both options, annual first", () => {
    expect(PAYWALL_PLANS.map((plan) => plan.id)).toEqual([YEARLY_PLAN.id, MONTHLY_PLAN.id]);
  });

  it("keeps the label price in step with the amount used for the maths", () => {
    for (const plan of PAYWALL_PLANS) {
      expect(plan.priceLabel).toBe(`$${plan.amount.toFixed(2)}`);
    }
  });
});

describe("savingPercent", () => {
  it("is the real 33% — 79.99/yr against 119.88/yr paid monthly", () => {
    expect(savingPercent(YEARLY_PLAN, MONTHLY_PLAN)).toBe(33);
  });

  it("claims nothing when the longer plan is not actually cheaper", () => {
    const overpriced: PaywallPlan = { ...YEARLY_PLAN, amount: 119.88 };
    expect(savingPercent(overpriced, MONTHLY_PLAN)).toBeNull();
    expect(savingBadge(overpriced, MONTHLY_PLAN)).toBeNull();
    expect(comparisonNote(overpriced, MONTHLY_PLAN)).toBeNull();
  });

  it("claims nothing when comparing a plan against itself", () => {
    expect(savingPercent(MONTHLY_PLAN, MONTHLY_PLAN)).toBeNull();
    expect(savingBadge(MONTHLY_PLAN, MONTHLY_PLAN)).toBeNull();
  });

  it("degrades to null on nonsense inputs instead of dividing by zero", () => {
    expect(savingPercent({ ...YEARLY_PLAN, months: 0 }, MONTHLY_PLAN)).toBeNull();
    expect(savingPercent(YEARLY_PLAN, { ...MONTHLY_PLAN, months: 0 })).toBeNull();
    expect(savingPercent(YEARLY_PLAN, { ...MONTHLY_PLAN, amount: 0 })).toBeNull();
  });
});

describe("plan notes", () => {
  it("badges the annual plan with the computed saving", () => {
    expect(savingBadge(YEARLY_PLAN, MONTHLY_PLAN)).toBe("Save 33%");
  });

  it("shows the per-month read of the annual plan", () => {
    expect(perMonthNote(YEARLY_PLAN)).toBe("$6.67 a month, billed yearly");
  });

  it("has no per-month note on the monthly plan", () => {
    expect(perMonthNote(MONTHLY_PLAN)).toBeNull();
  });

  it("spells out both yearly totals in the comparison", () => {
    const note = comparisonNote(YEARLY_PLAN, MONTHLY_PLAN);
    expect(note).toContain("$79.99 per year");
    expect(note).toContain("$119.88");
    expect(note).toContain("33%");
  });
});

describe("the call to action", () => {
  it("carries the price and the duration, not just the word Subscribe", () => {
    expect(subscribeLabel(YEARLY_PLAN)).toBe("Subscribe — $79.99 per year");
    expect(subscribeLabel(MONTHLY_PLAN)).toBe("Subscribe — $9.99 per month");
  });
});

describe("the required disclosure", () => {
  // Guideline 3.1.2 — a subscription screen missing any of these is rejected.
  it.each([
    ["auto-renewable", /auto-renewable subscription/i],
    ["charged to the Apple ID", /charged to your Apple ID/i],
    ["renews automatically", /renews automatically/i],
    ["the 24-hour cancellation window", /24 hours before the end/i],
    ["managing it in Apple ID settings", /manage or cancel[\s\S]*Apple ID settings/i],
  ])("states %s", (_label, pattern) => {
    expect(RENEWAL_DISCLOSURE).toMatch(pattern);
  });

  it("says what the subscription unlocks and what stays free", () => {
    expect(PRO_BENEFITS[0]).toMatch(/unlimited/i);
    expect(FREE_TIER_NOTE).toMatch(/first 3 analyses/i);
  });
});

describe("restoreMessage", () => {
  it("only claims a restored subscription when the store confirmed one", () => {
    expect(restoreMessage({ status: "restored" })).toMatch(/has been restored/i);
    expect(restoreMessage({ status: "none" })).toMatch(/no active/i);
    // The ambiguous case must not imply success either way.
    expect(restoreMessage({ status: "completed" })).toMatch(/restore finished/i);
    expect(restoreMessage({ status: "completed" })).not.toMatch(/your .*subscription has been/i);
  });

  it("passes a failure's own message through", () => {
    expect(restoreMessage({ status: "failed", message: "No network." })).toBe("No network.");
  });

  it("explains an unconfigured store rather than blaming the user", () => {
    expect(restoreMessage({ status: "unavailable" })).toMatch(/isn't available in this build/i);
  });
});
