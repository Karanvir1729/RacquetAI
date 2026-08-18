import { useEffect, useState } from "react";

import { PaywallScreen } from "@/features/subscription/PaywallScreen";
import type { PlanId } from "@/features/subscription/paywallCopy";
import {
  loadPackages,
  purchase,
  restorePurchases,
  useSubscriptionStatus,
} from "@/lib/subscription";

/**
 * RacquetIQ Pro — thin route; the screen lives in features/subscription and the
 * store plumbing in lib/subscription. Hidden from the tab bar (`href: null` in
 * _layout) and reached from the Library's import card once the free analyses
 * are spent, or from the paywall link on it.
 *
 * The screen takes the store as props on purpose: with none of them it still
 * renders the offer and says purchasing is unavailable, which is exactly what
 * happens in a build with no RevenueCat key.
 */
export default function PaywallRoute() {
  const { entitlement, loading, purchasingAvailable } = useSubscriptionStatus();
  const storePrices = useStorePrices(purchasingAvailable);
  return (
    <PaywallScreen
      entitlement={entitlement}
      loading={loading}
      purchasingAvailable={purchasingAvailable}
      purchase={purchase}
      restorePurchases={restorePurchases}
      storePrices={storePrices}
    />
  );
}

/**
 * The store's own localized price strings, or undefined until (or unless) it
 * answers — the screen falls back to its built-in USD labels, so a slow or
 * unreachable store shows the offer rather than an empty card.
 */
function useStorePrices(configured: boolean): Partial<Record<PlanId, string>> | undefined {
  const [prices, setPrices] = useState<Partial<Record<PlanId, string>>>();

  // Keyed on `configured`, not [] — this screen can mount before the root
  // layout's configure() effect has run, and a one-shot fetch would then miss
  // the store forever and quote the built-in USD labels to every storefront,
  // which is the exact failure this price lookup exists to prevent.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      const result = await loadPackages();
      if (cancelled || result.status !== "ok") return;
      const next: Partial<Record<PlanId, string>> = {};
      for (const entry of result.packages) {
        if (entry.priceString.length > 0) next[entry.productId as PlanId] = entry.priceString;
      }
      if (Object.keys(next).length > 0) setPrices(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  return prices;
}
