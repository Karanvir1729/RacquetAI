/**
 * Everything the paywall SAYS and every number it shows, kept out of the view
 * so it can be unit-tested. App Review reads this screen line by line, and the
 * prices here have to agree with App Store Connect (subscription group
 * "RacketIQ Pro", id 22316619) or the app is rejected for misleading pricing.
 *
 * The saving is COMPUTED, never typed in: a badge claiming a discount the
 * arithmetic does not support is both a rejection and a refund request.
 */
import type { RestoreOutcome } from "./subscriptionApi";

export type PlanId = "racquetiq_pro_monthly" | "racquetiq_pro_yearly";

export interface PaywallPlan {
  /** App Store Connect product id. */
  id: PlanId;
  /** Short name for the option row ("Monthly"). */
  name: string;
  /** Price exactly as the store lists it. */
  priceLabel: string;
  /** Duration, spelled out — Apple requires the period next to the price. */
  periodLabel: string;
  /** USD renewal price. Only used to compute the saving; never rendered raw. */
  amount: number;
  /** Months one purchase covers. */
  months: number;
}

export const MONTHLY_PLAN: PaywallPlan = {
  id: "racquetiq_pro_monthly",
  name: "Monthly",
  priceLabel: "$9.99",
  periodLabel: "per month",
  amount: 9.99,
  months: 1,
};

export const YEARLY_PLAN: PaywallPlan = {
  id: "racquetiq_pro_yearly",
  name: "Annual",
  priceLabel: "$79.99",
  periodLabel: "per year",
  amount: 79.99,
  months: 12,
};

/** Annual first — it is the better deal, and the saving line proves it. */
export const PAYWALL_PLANS: readonly PaywallPlan[] = [YEARLY_PLAN, MONTHLY_PLAN];

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Whole-percent saving of `plan` against paying `reference` for the same span,
 * or null when it is not actually cheaper (or the inputs are nonsense).
 */
export function savingPercent(plan: PaywallPlan, reference: PaywallPlan): number | null {
  if (!(plan.months > 0) || !(reference.months > 0) || !(reference.amount > 0)) return null;
  const equivalent = reference.amount * (plan.months / reference.months);
  if (!(plan.amount < equivalent)) return null;
  return Math.round((1 - plan.amount / equivalent) * 100);
}

/** Badge for the cheaper plan: "Save 33%", or null when there is no saving. */
export function savingBadge(plan: PaywallPlan, reference: PaywallPlan): string | null {
  const percent = savingPercent(plan, reference);
  return percent === null ? null : `Save ${percent}%`;
}

/** "$6.67 a month, billed yearly" — the honest per-month read of a long plan. */
export function perMonthNote(plan: PaywallPlan): string | null {
  if (plan.months <= 1) return null;
  return `${usd(plan.amount / plan.months)} a month, billed yearly`;
}

/** The full comparison, spelled out: what each route costs over a year. */
export function comparisonNote(plan: PaywallPlan, reference: PaywallPlan): string | null {
  const percent = savingPercent(plan, reference);
  if (percent === null) return null;
  const equivalent = reference.amount * (plan.months / reference.months);
  return `${plan.priceLabel} ${plan.periodLabel} instead of ${usd(equivalent)} paying monthly — you save ${percent}%.`;
}

/** Primary CTA. The price and period ride on the button, not just above it. */
export function subscribeLabel(plan: PaywallPlan): string {
  return `Subscribe — ${plan.priceLabel} ${plan.periodLabel}`;
}

export const PAYWALL_TITLE = "RacketIQ Pro";
export const PAYWALL_SUBTITLE = "Unlimited match analyses";

export const PAYWALL_LEAD =
  "You get 3 free analyses of your own videos. Pro lifts that cap so every match you film can be analysed.";

/** Only things the app actually does today — see the analysis screen. */
export const PRO_BENEFITS: readonly string[] = [
  "Unlimited analyses of your own match videos",
  "Shot placement, court coverage and rally stats on every match",
  "Your predictability score and most common shot pattern",
  "Every analysis saved in your library to compare over time",
];

export const FREE_TIER_NOTE =
  "Recording, your library, the demo analysis and your first 3 analyses stay free — subscribing is optional.";

/**
 * The disclosure Apple requires verbatim in substance (Review Guideline 3.1.2):
 * auto-renewing, charged to the Apple ID, renews unless cancelled 24 hours
 * before the period ends, manageable in Apple ID settings.
 */
export const RENEWAL_DISCLOSURE =
  "RacketIQ Pro is an auto-renewable subscription. Payment is charged to your Apple ID at confirmation of purchase. " +
  "It renews automatically at the same price and duration unless you cancel at least 24 hours before the end of the " +
  "current period, and your Apple ID is charged for the renewal within 24 hours of the period ending. " +
  "You can manage or cancel your subscription at any time in your Apple ID settings (Settings › your name › Subscriptions).";

/** Shown instead of a dead Subscribe button when the store isn't wired up. */
export const PURCHASES_UNAVAILABLE =
  "In-app purchasing isn't available in this build — the App Store connection isn't configured yet. " +
  "Nothing is locked: keep using RacketIQ as normal.";

/**
 * Shown the moment the store says a purchase completed, BEFORE (and regardless
 * of whether) the entitlement read confirms it.
 *
 * The wording stops short of "you are subscribed" on purpose: what we know is
 * that the store completed the transaction, not that we could read the
 * entitlement back — an unreadable CustomerInfo leaves that at "unknown". So it
 * confirms the charge, which is the part the user needs to hear immediately,
 * and points at Restore as the way to settle anything that still looks locked.
 */
export const PURCHASE_CONFIRMED =
  "Purchase complete — thank you. RacketIQ Pro is being applied to this Apple ID. " +
  "If anything still looks locked in a moment, tap Restore purchases below.";

export const SUBSCRIBED_TITLE = "You're subscribed";
export const SUBSCRIBED_BODY =
  "RacketIQ Pro is active on this Apple ID. Analyse as many matches as you like.";

export const CHECKING_ENTITLEMENT = "Checking your subscription…";

export const LEGAL_PENDING_NOTE =
  "These pages go live before the App Store release; the links are disabled until then.";

/** User-facing result of a restore. Never claims a subscription it can't see. */
export function restoreMessage(outcome: RestoreOutcome): string {
  switch (outcome.status) {
    case "restored":
      return "Your RacketIQ Pro subscription has been restored.";
    case "none":
      return "No active RacketIQ Pro subscription was found on this Apple ID.";
    case "completed":
      return "Restore finished. Any subscription on this Apple ID has been applied.";
    case "unavailable":
      return PURCHASES_UNAVAILABLE;
    case "failed":
      return outcome.message;
  }
}
