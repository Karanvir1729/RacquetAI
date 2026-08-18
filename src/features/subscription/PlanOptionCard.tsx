/**
 * One selectable subscription option. Price and duration always render together
 * — Apple requires both next to each other, not the price alone with the period
 * buried in the small print.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import type { PaywallPlan } from "./paywallCopy";

interface PlanOptionCardProps {
  plan: PaywallPlan;
  selected: boolean;
  /** Honest saving badge ("Save 33%"), or null when there is nothing to claim. */
  badge?: string | null;
  /** Secondary line, e.g. the per-month read of an annual plan. */
  note?: string | null;
  disabled?: boolean;
  onSelect: () => void;
}

export function PlanOptionCard({
  plan,
  selected,
  badge = null,
  note = null,
  disabled = false,
  onSelect,
}: PlanOptionCardProps) {
  const press = () => {
    selectionHaptic();
    onSelect();
  };
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${plan.name}, ${plan.priceLabel} ${plan.periodLabel}${badge === null ? "" : `, ${badge}`}`}
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Card compact style={selected ? [styles.card, styles.cardSelected] : styles.card}>
        <View style={styles.row}>
          <Ionicons
            name={selected ? "radio-button-on" : "radio-button-off"}
            size={22}
            color={selected ? colors.accent : colors.textFaint}
          />
          <View style={styles.text}>
            <View style={styles.titleRow}>
              <Text style={styles.name}>{plan.name}</Text>
              {badge === null ? null : (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{badge}</Text>
                </View>
              )}
            </View>
            <Text style={styles.price}>
              {plan.priceLabel} <Text style={styles.period}>{plan.periodLabel}</Text>
            </Text>
            {note === null ? null : <Text style={styles.note}>{note}</Text>}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: MIN_TOUCH_TARGET + spacing.lg },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.xs },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...type.bodyStrong, color: colors.text },
  price: { ...type.heading, color: colors.text },
  period: { ...type.body, color: colors.textDim },
  note: { ...type.caption, color: colors.textDim },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeLabel: { ...type.captionStrong, color: colors.onAccent },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
