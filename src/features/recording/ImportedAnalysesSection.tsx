/**
 * "Imported analyses" Library section: every `imp-….analysis.json` the import
 * flow has saved, newest first, tap to reopen /analysis?id=…, trash to delete
 * after a confirm. Reads the filesystem on every tab focus (the useRecordings
 * pattern) so an analysis finished moments ago is already listed. Renders
 * nothing when there are no imports — the section earns its header only once
 * it has rows.
 */
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { notifyWarning, selection as selectionHaptic } from "@/lib/haptics";
import {
  deleteImportedAnalysis,
  listImportedAnalyses,
  type ImportedAnalysisEntry,
} from "@/lib/importedAnalyses";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { formatRecordedAt } from "./display";

export function ImportedAnalysesSection() {
  const [entries, setEntries] = useState<ImportedAnalysisEntry[]>([]);

  const reload = useCallback(() => {
    // Render-path read: a disk error means "no imports", never a crashed Library.
    try {
      setEntries(listImportedAnalyses());
    } catch {
      setEntries([]);
    }
  }, []);

  useFocusEffect(reload);

  if (entries.length === 0) return null;

  const confirmDelete = (entry: ImportedAnalysisEntry) => {
    notifyWarning();
    Alert.alert(
      "Delete imported analysis?",
      `${formatRecordedAt(entry.createdAt.toISOString())}. This removes the analysis permanently.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            try {
              deleteImportedAnalysis(entry.id);
            } catch {
              Alert.alert("Couldn't delete", "The analysis could not be removed. Try again.");
            }
            reload();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <Text style={styles.header}>Imported analyses</Text>
      {entries.map((entry) => {
        const title = formatRecordedAt(entry.createdAt.toISOString());
        return (
          <Card key={entry.id} compact style={styles.rowCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open imported analysis, ${title}`}
              onPress={() => {
                selectionHaptic();
                router.push({ pathname: "/analysis", params: { id: entry.id } });
              }}
              style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
            >
              <View style={styles.thumb}>
                <Ionicons name="analytics" size={18} color={colors.onAccent} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  Imported analysis
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {title}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete imported analysis, ${title}`}
              hitSlop={spacing.sm}
              onPress={() => confirmDelete(entry)}
              style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  header: { ...type.label, color: colors.textDim, paddingTop: spacing.xs },
  rowCard: { flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.caption, color: colors.textDim },
  rowAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
});
