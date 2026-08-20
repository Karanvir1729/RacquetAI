/**
 * The login that stands in front of the app.
 *
 * Rendered by the root layout as an overlay ABOVE the tab shell whenever there
 * is no session — the same layer trick the tutorial uses, so expo-router's
 * Tabs never unmount and remount underneath it. Signing in simply lifts the
 * layer; signing out anywhere drops it back.
 *
 * Two states on purpose:
 * - auth not yet restored → an empty canvas. The persisted session is read in
 *   the first moments of a cold start, and flashing the sign-in form at a
 *   user who IS signed in would read as being logged out once per launch.
 * - restored, no session → the same SignInCard the Account tab uses, so there
 *   is exactly one login UI to keep correct.
 */
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthReady, useAuthSession } from "@/lib/auth";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, spacing, type } from "@/theme/tokens";

import { SignInCard } from "./AccountScreen";

/** Should the gate cover the app right now? The layout asks before mounting. */
export function useAuthGate(): { covered: boolean; restoring: boolean } {
  const ready = useAuthReady();
  const session = useAuthSession();
  return { covered: !ready || session === null, restoring: !ready };
}

export function AuthGateScreen() {
  const { restoring } = useAuthGate();
  const insets = useSafeAreaInsets();

  // Restore in flight: hold the canvas, decide nothing. It resolves in well
  // under a second and either outcome repaints this layer.
  if (restoring) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.column}>
          <Text style={styles.title}>RacketIQ</Text>
          <Text style={styles.caption}>
            Sign in to record, analyse and referee your matches. Your account keeps them yours.
          </Text>
          <SignInCard />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  column: { ...column(FORM_MAX_WIDTH), gap: spacing.md },
  title: { ...type.display, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
});
