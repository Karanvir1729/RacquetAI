/**
 * Re-opens the first-run tutorial from the Library. With no Settings tab left,
 * this is the only way back to it — and the filming and corner-marking advice
 * is worth re-reading before a match, not just once on install.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { TutorialScreen } from "@/features/onboarding/TutorialScreen";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, spacing, type } from "@/theme/tokens";

export function HowItWorksCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="How it works — replay the tutorial"
        onPress={() => {
          selectionHaptic();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Ionicons name="help-circle-outline" size={18} color={colors.textDim} />
        <Text style={styles.label}>How it works</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <TutorialScreen onDone={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  label: { ...type.caption, color: colors.textDim },
  sheet: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
});
