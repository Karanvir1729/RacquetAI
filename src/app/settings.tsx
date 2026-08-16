import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ServerConfigCard } from "@/features/analysis/ServerConfigCard";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

interface LinkItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** null = operator has not provided the URL yet; row renders as pending. */
  url: string | null;
}

// Operator-TODO: fill these before the first App Store submission
// (docs/07-app-store-prep.md tracks them). Null rows render as "coming soon"
// so the app never ships a dead link — dead links are an App Review risk.
const LINKS: readonly LinkItem[] = [
  { label: "Website", icon: "globe-outline", url: null },
  { label: "Privacy policy", icon: "shield-checkmark-outline", url: null },
  { label: "Contact support", icon: "mail-outline", url: null },
];

function LinkRow({ item }: { item: LinkItem }) {
  const pending = item.url === null;
  const open = () => {
    if (pending) return;
    selectionHaptic();
    // Guarded open: a device with no handler (e.g. no mail app) must not crash.
    Linking.openURL(item.url as string).catch(() => {
      Alert.alert("Couldn't open link", "Try again from a browser.");
    });
  };
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={pending ? `${item.label}, coming soon` : item.label}
      onPress={open}
      disabled={pending}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Ionicons name={item.icon} size={20} color={pending ? colors.textFaint : colors.accent} />
      <Text style={[styles.rowLabel, pending && styles.rowLabelPending]}>{item.label}</Text>
      {pending ? (
        <Text style={styles.rowPending}>coming soon</Text>
      ) : (
        <Ionicons name="open-outline" size={16} color={colors.textFaint} />
      )}
    </Pressable>
  );
}

/**
 * Settings: the one fully-built baseline screen. About (name + version),
 * links, and the open-source licenses placeholder. Account, subscriptions,
 * and per-sport preferences arrive with their features.
 */
export default function SettingsScreen() {
  return (
    <Screen scroll>
      <ScreenHeader title="Settings" />

      <Card>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutRow}>
          <View style={styles.appMark}>
            <Ionicons name="tennisball" size={26} color={colors.onAccent} />
          </View>
          <View style={styles.aboutBody}>
            <Text style={styles.appName}>RacquetIQ</Text>
            <Text style={styles.appMeta}>Version {APP_VERSION}</Text>
          </View>
        </View>
        <Text style={styles.aboutNote}>
          Record your matches. Review your play. AI score tracking is on the way.
        </Text>
      </Card>

      <ServerConfigCard />

      <Card>
        <Text style={styles.sectionTitle}>Links</Text>
        {LINKS.map((item) => (
          <LinkRow key={item.label} item={item} />
        ))}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Open-source licenses</Text>
        <Text style={styles.licenseBody}>
          RacquetIQ is built on open-source software, including React Native and the Expo SDK.
          Full license attributions will be listed here before the first App Store release
          (tracked in docs/07-app-store-prep.md).
        </Text>
      </Card>

      <Text style={styles.footer}>RacquetIQ · made for court time</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...type.heading, color: colors.text },
  aboutRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  appMark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  aboutBody: { flex: 1, gap: 2 },
  appName: { ...type.bodyStrong, color: colors.text },
  appMeta: { ...type.caption, color: colors.textDim },
  aboutNote: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  rowPressed: { opacity: 0.7 },
  rowLabel: { ...type.body, color: colors.text, flex: 1 },
  rowLabelPending: { color: colors.textFaint },
  rowPending: { ...type.caption, color: colors.textFaint, fontStyle: "italic" },
  licenseBody: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  footer: {
    ...type.caption,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
