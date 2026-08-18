/**
 * Let / stroke / no-let, one modal away from the main screen.
 *
 * Kept OFF the main surface on purpose: appeals are a fraction of the calls in
 * a match, and putting six more targets next to the two that matter is how a
 * courtside scoreboard becomes unusable. One "Let…" button opens this; the two
 * rally buttons never move.
 *
 * The rulings are spelled out in terms of their consequence ("point to Sam")
 * rather than by name alone, because the people using this are usually the two
 * players, and "no let" is the one squash rule everybody argues about.
 */
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Segmented } from "@/components/Segmented";
import { selection as selectionHaptic, tapMedium } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { PlayerNames } from "./announce";
import { LetRuling, OTHER_SIDE, Side } from "./types";

interface AppealSheetProps {
  visible: boolean;
  names: PlayerNames;
  /** Pre-selected appealer: the receiver appeals far more often than the server. */
  appealer: Side;
  onChangeAppealer: (side: Side) => void;
  onRule: (ruling: LetRuling) => void;
  onClose: () => void;
}

export function AppealSheet({
  visible,
  names,
  appealer,
  onChangeAppealer,
  onRule,
  onClose,
}: AppealSheetProps) {
  const opponent = OTHER_SIDE[appealer];
  const rulings: { key: LetRuling; label: string; caption: string }[] = [
    { key: "let", label: "Let", caption: "Rally replayed — no point, same server" },
    { key: "stroke", label: "Stroke", caption: `Point to ${names[appealer]}` },
    { key: "no-let", label: "No let", caption: `Point to ${names[opponent]}` },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the scrim dismisses: no ruling is the safe default here. */}
      <Pressable style={styles.scrim} accessibilityLabel="Dismiss" onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Interference call</Text>
        <Text style={styles.caption}>Who asked for the let?</Text>
        <Segmented
          options={[
            { key: "A" as const, label: names.A },
            { key: "B" as const, label: names.B },
          ]}
          value={appealer}
          onChange={onChangeAppealer}
        />
        {rulings.map((ruling) => (
          <Pressable
            key={ruling.key}
            accessibilityRole="button"
            accessibilityLabel={`${ruling.label}. ${ruling.caption}`}
            onPress={() => {
              tapMedium();
              onRule(ruling.key);
            }}
            style={({ pressed }) => [styles.ruling, pressed && styles.pressed]}
          >
            <Text style={styles.rulingLabel}>{ruling.label}</Text>
            <Text style={styles.rulingCaption}>{ruling.caption}</Text>
          </Pressable>
        ))}
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => {
            selectionHaptic();
            onClose();
          }}
          haptic="none"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  ruling: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  rulingLabel: { ...type.bodyStrong, color: colors.text },
  rulingCaption: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
