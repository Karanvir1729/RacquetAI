import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ServerConfigCard } from "@/features/analysis/ServerConfigCard";
import { colors, radius, spacing, type } from "@/theme/tokens";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/**
 * Settings: About (name + version) and the analysis-engine configuration —
 * nothing else. Placeholder rows ("coming soon" links, a licenses stub) were
 * cut: a settings screen that mostly advertises what it cannot do reads as
 * unfinished. They come back when they point at something real.
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
          Record your matches. Import a video. See where every shot landed.
        </Text>
      </Card>

      <ServerConfigCard />

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
  footer: {
    ...type.caption,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
