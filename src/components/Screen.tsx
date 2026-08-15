import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useKeyboardInset } from "@/lib/useKeyboardInset";
import { column, CONTENT_MAX_WIDTH } from "@/theme/layout";
import { colors, spacing } from "@/theme/tokens";

interface ScreenProps extends PropsWithChildren {
  /** Scrollable content (settings, lists of cards). The camera screen manages its own layout. */
  scroll?: boolean;
  /** Extra bottom padding for screens without a tab bar (modals, full-screen player). */
  padBottom?: boolean;
}

/** Canvas wrapper — every screen sits on the court-green background. */
export function Screen({ children, scroll = false, padBottom = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  // Android only (0 elsewhere): shrink the frame by the keyboard height so the
  // native ScrollView scrolls the focused field into view — the iOS prop below
  // has no Android counterpart under enforced edge-to-edge. It replaces the
  // safe-area bottom pad while the keyboard is up (the gesture bar is covered).
  const keyboardInset = useKeyboardInset();
  const containerStyle = [
    styles.container,
    { paddingTop: insets.top },
    padBottom || keyboardInset ? { paddingBottom: keyboardInset || insets.bottom } : null,
  ];

  if (scroll) {
    return (
      // automaticallyAdjustKeyboardInsets, NOT KeyboardAvoidingView: `padding`
      // only shrinks the frame, it never moves contentOffset, so RN's
      // scroll-to-first-responder never runs and a focused field low in the
      // viewport is simply cut off. Never use both — that double-avoids and
      // leaves a keyboard-height gap under the content.
      <ScrollView
        style={containerStyle}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        {/* The gap lives on this column, not on contentContainerStyle, so the
            children keep their spacing while the column itself stays centred
            and readable-width on iPad (layout.ts / ADR-002). */}
        <View style={styles.column}>{children}</View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.flex, ...containerStyle]}>
      <View style={styles.columnFill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
  column: { ...column(CONTENT_MAX_WIDTH), gap: spacing.md },
  columnFill: { ...column(CONTENT_MAX_WIDTH), flex: 1 },
});
