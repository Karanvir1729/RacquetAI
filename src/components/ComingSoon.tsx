import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { colors, radius, spacing, type } from "@/theme/tokens";

interface ComingSoonProps {
  title: string;
  /** Which branch/phase delivers this screen (e.g. "feat/ai-scoring"). */
  phase: string;
  description: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional call to action so the state is never a dead end. */
  actionLabel?: string;
  onAction?: () => void;
}

/** Placeholder for sections that land in a later phase / parallel worktree. */
export function ComingSoon({
  title,
  phase,
  description,
  icon = "tennisball-outline",
  actionLabel,
  onAction,
}: ComingSoonProps) {
  return (
    <Screen>
      <View style={styles.body}>
        <Ionicons name={icon} size={56} color={colors.accent} style={styles.mark} />
        <Text style={styles.title}>{title}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{phase}</Text>
        </View>
        <Text style={styles.note}>{description}</Text>
        {actionLabel && onAction ? (
          <View style={styles.action}>
            <Button label={actionLabel} onPress={onAction} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mark: { opacity: 0.9, marginBottom: spacing.xs },
  title: { ...type.title, color: colors.text, textAlign: "center" },
  badge: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.glow,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: { ...type.captionStrong, color: colors.accentText },
  note: { ...type.body, color: colors.textDim, textAlign: "center", maxWidth: 300 },
  action: { alignSelf: "stretch", maxWidth: 300, marginTop: spacing.sm },
});
