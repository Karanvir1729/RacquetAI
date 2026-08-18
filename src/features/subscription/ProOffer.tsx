/**
 * The offer itself: what Pro is, what it unlocks, and the two plans — or, for
 * someone who already pays, the confirmation that replaces all of it.
 *
 * Split out of PaywallScreen so that screen stays the state machine and this
 * stays the pitch; the prices and the saving are computed in paywallCopy.ts and
 * only rendered here.
 */
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import {
  comparisonNote,
  MONTHLY_PLAN,
  PAYWALL_LEAD,
  PAYWALL_PLANS,
  perMonthNote,
  PRO_BENEFITS,
  savingBadge,
  SUBSCRIBED_BODY,
  SUBSCRIBED_TITLE,
  YEARLY_PLAN,
  type PlanId,
} from "./paywallCopy";
import { PlanOptionCard } from "./PlanOptionCard";

interface ProOfferProps {
  subscribed: boolean;
  selectedId: PlanId;
  /** True while a purchase or restore is in flight — no switching plans mid-buy. */
  locked: boolean;
  onSelect: (id: PlanId) => void;
  /** Localized store prices by product id; the USD constants are the fallback. */
  storePrices?: Partial<Record<PlanId, string>>;
}

export function ProOffer({ subscribed, selectedId, locked, onSelect, storePrices }: ProOfferProps) {
  // Computed from the plan amounts, so it can never advertise a saving the
  // prices do not support; null when the annual plan is not actually cheaper.
  const comparison = comparisonNote(YEARLY_PLAN, MONTHLY_PLAN);
  return (
    <>
      {/* The pitch is for people who haven't bought. A subscriber still gets the
          benefit list — a reminder of what they pay for — but not a sales line
          about a cap that no longer applies to them. */}
      {subscribed ? null : <Text style={styles.lead}>{PAYWALL_LEAD}</Text>}

      <View style={styles.benefits}>
        {PRO_BENEFITS.map((benefit) => (
          <View key={benefit} style={styles.benefit}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.accentText}
              style={styles.benefitIcon}
            />
            <Text style={styles.benefitText}>{benefit}</Text>
          </View>
        ))}
      </View>

      {subscribed ? (
        <Card style={styles.activeCard}>
          <Text style={styles.activeTitle}>{SUBSCRIBED_TITLE}</Text>
          <Text style={styles.activeBody}>{SUBSCRIBED_BODY}</Text>
        </Card>
      ) : (
        <View style={styles.plans} accessibilityRole="radiogroup">
          {PAYWALL_PLANS.map((option) => (
            <PlanOptionCard
              key={option.id}
              plan={priced(option, storePrices)}
              selected={option.id === selectedId}
              badge={savingBadge(option, MONTHLY_PLAN)}
              note={perMonthNote(option)}
              disabled={locked}
              onSelect={() => onSelect(option.id)}
            />
          ))}
          {comparison === null ? null : <Text style={styles.comparison}>{comparison}</Text>}
        </View>
      )}
    </>
  );
}

/**
 * The plan as the store describes it. Only the DISPLAYED price is swapped —
 * `amount` stays the built-in number, because the saving comparison is
 * arithmetic on known values and must never be computed from a parsed
 * currency string.
 */
function priced(
  plan: (typeof PAYWALL_PLANS)[number],
  storePrices: Partial<Record<PlanId, string>> | undefined,
): (typeof PAYWALL_PLANS)[number] {
  const fromStore = storePrices?.[plan.id];
  return fromStore === undefined ? plan : { ...plan, priceLabel: fromStore };
}

const styles = StyleSheet.create({
  lead: { ...type.body, color: colors.textDim, lineHeight: 22 },
  benefits: { gap: spacing.sm },
  benefit: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  // Nudged onto the first line's baseline, matching the tutorial's bullets.
  benefitIcon: { marginTop: 1 },
  benefitText: { ...type.body, color: colors.text, flex: 1, lineHeight: 22 },
  plans: { gap: spacing.sm },
  comparison: { ...type.caption, color: colors.textDim, paddingHorizontal: spacing.xs },
  activeCard: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  activeTitle: { ...type.heading, color: colors.text },
  activeBody: { ...type.caption, color: colors.textDim, lineHeight: 18 },
});
