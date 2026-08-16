/**
 * Settings card for the analysis-server base URL. Shows the current value with
 * an inline edit modal (token-styled, top-anchored so the keyboard never
 * covers it). Values go through serverConfig's normalize-and-persist; an
 * unusable entry alerts and keeps the previous URL. The hint matters: the
 * localhost default only works in a simulator on the same Mac as the server —
 * a phone on the same Wi-Fi needs the Mac's LAN IP.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { loadServerBaseUrl, saveServerBaseUrl } from "./serverConfig";

const HINT =
  "Videos you import are analyzed by the RacquetIQ analysis server. On a simulator, " +
  "localhost works as-is; on a phone, use your Mac's LAN IP on the same Wi-Fi, " +
  "e.g. http://192.168.1.20:8082.";

export function ServerConfigCard() {
  const [baseUrl, setBaseUrl] = useState(loadServerBaseUrl);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const openEditor = () => {
    selectionHaptic();
    setDraft(baseUrl);
    setEditing(true);
  };

  const save = () => {
    const stored = saveServerBaseUrl(draft);
    if (stored === null) {
      Alert.alert(
        "Invalid server URL",
        "Enter a URL like http://192.168.1.20:8082 (scheme optional).",
      );
      return;
    }
    setBaseUrl(stored);
    setEditing(false);
  };

  return (
    <Card>
      <Text style={styles.sectionTitle}>Analysis server</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Analysis server, ${baseUrl}. Edit`}
        onPress={openEditor}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Ionicons name="server-outline" size={20} color={colors.accent} />
        <Text style={styles.rowValue} numberOfLines={1}>
          {baseUrl}
        </Text>
        <Ionicons name="pencil-outline" size={16} color={colors.textFaint} />
      </Pressable>
      <Text style={styles.hint}>{HINT}</Text>

      <Modal
        visible={editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Analysis server URL</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={save}
              placeholder="http://192.168.1.20:8082"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Analysis server URL"
            />
            <Text style={styles.sheetHint}>
              {"Phone on the same Wi-Fi as your Mac? Use the Mac's LAN IP, not localhost."}
            </Text>
            <View style={styles.sheetButtons}>
              <View style={styles.buttonFlex}>
                <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
              </View>
              <View style={styles.buttonFlex}>
                <Button label="Save" onPress={save} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...type.heading, color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
  },
  rowValue: { ...type.body, color: colors.text, flex: 1 },
  hint: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  overlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: "flex-start",
    padding: spacing.md,
    paddingTop: 120,
  },
  sheet: {
    ...column(FORM_MAX_WIDTH),
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sheetTitle: { ...type.heading, color: colors.text },
  input: {
    ...type.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  sheetHint: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  sheetButtons: { flexDirection: "row", gap: spacing.sm },
  buttonFlex: { flex: 1 },
});
