/**
 * The subscription screen. This is the surface App Review scrutinises hardest,
 * so everything Guideline 3.1.2 asks for is ON it and none of it is behind a
 * tap: what Pro unlocks (ProOffer), both durations with their prices, the
 * honest annual saving, the auto-renewal disclosure and the Terms/Privacy links
 * (LegalFooter), and a Restore Purchases button.
 *
 * It is a SOFT paywall — free users still record, browse their library, watch
 * the demo, and keep their first three analyses — so it must always be
 * dismissable, and the dismiss must not depend on any store plumbing working.
 *
 * The store arrives as props (see subscriptionApi.ts); the route wires
 * lib/subscription.ts in. With no props at all this renders the UNCONFIGURED
 * state: the offer is visible and buying is plainly explained as unavailable,
 * rather than a button that throws when tapped.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

import { LegalFooter } from "./LegalFooter";
import {
  CHECKING_ENTITLEMENT,
  MONTHLY_PLAN,
  PAYWALL_SUBTITLE,
  PAYWALL_TITLE,
  PURCHASES_UNAVAILABLE,
  restoreMessage,
  subscribeLabel,
  YEARLY_PLAN,
  type PaywallPlan,
  type PlanId,
} from "./paywallCopy";
import { ProOffer } from "./ProOffer";
import {
  runPurchase,
  runRestore,
  type EntitlementState,
  type PurchaseFn,
  type RestoreFn,
} from "./subscriptionApi";

interface PaywallScreenProps {
  /** Verified entitlement. Defaults to "unknown" — never claims a subscription. */
  entitlement?: EntitlementState;
  /** True while the entitlement is still being fetched. */
  loading?: boolean;
  /**
   * False when RevenueCat has no key or its SDK is missing from the binary.
   * Combined with the presence of `purchase`, so a props-less render lands in
   * the unconfigured state instead of offering a button that cannot work.
   */
  purchasingAvailable?: boolean;
  purchase?: PurchaseFn;
  restorePurchases?: RestoreFn;
  /**
   * Localized price strings from the store, keyed by product id. The built-in
   * labels are USD and only correct in one storefront, so whenever the store
   * answers, its own formatting wins — a paywall that quotes $9.99 to someone
   * who will be charged in euros is both a bad experience and an App Review
   * problem.
   */
  storePrices?: Partial<Record<PlanId, string>>;
  /** Defaults to going back — the paywall must always be escapable. */
  onDismiss?: () => void;
}

export function PaywallScreen({
  entitlement = "unknown",
  loading = false,
  purchasingAvailable,
  purchase,
  restorePurchases,
  storePrices,
  onDismiss,
}: PaywallScreenProps) {
  const [selected, setSelected] = useState<PlanId>(YEARLY_PLAN.id);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const storeReady = purchasingAvailable ?? true;
  const canBuy = storeReady && typeof purchase === "function";
  const canRestore = storeReady && typeof restorePurchases === "function";
  const plan = selected === MONTHLY_PLAN.id ? MONTHLY_PLAN : YEARLY_PLAN;
  const subscribed = entitlement === "pro";

  const dismiss = () => {
    selectionHaptic();
    if (onDismiss) {
      onDismiss();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  const subscribe = async () => {
    if (purchase === undefined || !canBuy) return;
    setBusy("purchase");
    setError(null);
    setNotice(null);
    const outcome = await runPurchase(purchase, plan.id);
    setBusy(null);
    // A cancel stays silent by design: the user closed the sheet themselves, and
    // an error on top of that reads as a bug. A success needs no banner either —
    // the entitlement prop flips and the subscribed card takes over.
    if (outcome.status === "failed") setError(outcome.message);
    else if (outcome.status === "unavailable") setError(PURCHASES_UNAVAILABLE);
  };

  const restore = async () => {
    if (restorePurchases === undefined || !canRestore) return;
    setBusy("restore");
    setError(null);
    setNotice(null);
    const outcome = await runRestore(restorePurchases);
    setBusy(null);
    if (outcome.status === "failed") setError(outcome.message);
    else setNotice(restoreMessage(outcome));
  };

  return (
    <Screen>
      <CloseRow onPress={dismiss} />
      <ScreenHeader title={PAYWALL_TITLE} subtitle={PAYWALL_SUBTITLE} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <ProOffer
          subscribed={subscribed}
          selectedId={plan.id}
          locked={busy !== null}
          onSelect={setSelected}
          storePrices={storePrices}
        />

        <PurchaseAction
          loading={loading}
          subscribed={subscribed}
          canBuy={canBuy}
          plan={
            storePrices?.[plan.id] === undefined
              ? plan
              : { ...plan, priceLabel: storePrices[plan.id] as string }
          }
          busy={busy}
          onSubscribe={() => void subscribe()}
        />

        {error === null ? null : <Text style={styles.error}>{error}</Text>}
        {notice === null ? null : <Text style={styles.notice}>{notice}</Text>}

        {/* Apple rejects a subscription app without a restore path, so this is
            always present — disabled when the store is unreachable, never gone. */}
        <Button
          label="Restore purchases"
          variant="secondary"
          onPress={() => void restore()}
          loading={busy === "restore"}
          disabled={!canRestore || busy !== null}
        />

        <LegalFooter showFreeTierNote={!subscribed} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue without subscribing"
          onPress={dismiss}
          style={({ pressed }) => [styles.later, pressed && styles.pressed]}
        >
          <Text style={styles.laterLabel}>Not now</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function CloseRow({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.closeRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onPress}
        hitSlop={spacing.sm}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={22} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

interface PurchaseActionProps {
  loading: boolean;
  subscribed: boolean;
  canBuy: boolean;
  plan: PaywallPlan;
  busy: "purchase" | "restore" | null;
  onSubscribe: () => void;
}

/** The buy slot: spinner, nothing (already Pro), the CTA, or the plain reason why not. */
function PurchaseAction({
  loading,
  subscribed,
  canBuy,
  plan,
  busy,
  onSubscribe,
}: PurchaseActionProps) {
  if (loading) return <LoadingState caption={CHECKING_ENTITLEMENT} />;
  if (subscribed) return null;
  if (!canBuy) {
    return (
      <Card style={styles.noticeCard}>
        <Text style={styles.noticeText}>{PURCHASES_UNAVAILABLE}</Text>
      </Card>
    );
  }
  return (
    <Button
      label={subscribeLabel(plan)}
      onPress={onSubscribe}
      loading={busy === "purchase"}
      disabled={busy !== null}
    />
  );
}

const styles = StyleSheet.create({
  closeRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.md },
  close: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  noticeCard: { backgroundColor: colors.cardRaised },
  noticeText: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  error: { ...type.caption, color: colors.danger, lineHeight: 18 },
  notice: { ...type.caption, color: colors.accentText, lineHeight: 18 },
  later: { minHeight: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  laterLabel: { ...type.label, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
