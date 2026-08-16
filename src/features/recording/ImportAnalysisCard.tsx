/**
 * Library card that starts the import flow: system video picker (PHPicker via
 * expo-image-picker — no photo-library permission prompt on iOS 14+), then
 * navigate to /import-analysis with the picked file's URI. Navigates by route
 * only — no import from features/analysis internals (docs/01 rule 2), same as
 * DemoAnalysisCard.
 */
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

export function ImportAnalysisCard() {
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    selectionHaptic();
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      router.push({ pathname: "/import-analysis", params: { videoUri: result.assets[0].uri } });
    } catch {
      Alert.alert("Couldn't open your videos", "The video picker failed to open. Try again.");
    } finally {
      setPicking(false);
    }
  };

  return (
    <Card compact style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Import a video and analyze it"
        disabled={picking}
        onPress={() => void pick()}
        style={({ pressed }) => [styles.body, (pressed || picking) && styles.pressed]}
      >
        <View style={styles.icon}>
          <Ionicons name="cloud-upload" size={20} color={colors.onAccent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            Import & analyze
          </Text>
          <Text style={styles.caption} numberOfLines={2}>
            Pick a match video from your library and send it to your analysis server.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.accentSoft, borderColor: colors.line2 },
  body: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 2 },
  title: { ...type.bodyStrong, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
});
