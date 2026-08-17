/**
 * Settings card for the analysis section. Two parts:
 *
 * 1. Backend choice — "On this device (no server needed)" vs "Analysis
 *    server". The stored preference defaults to device; when the
 *    racquet-analyzer module is unavailable (Expo Go) the device row renders
 *    disabled with a hint and the selection shows the effective backend
 *    (server), exactly what resolveBackend gives the import flow.
 * 2. The analysis-server base URL with an inline edit modal (token-styled,
 *    top-anchored so the keyboard never covers it). Values go through
 *    serverConfig's normalize-and-persist; an unusable entry alerts and keeps
 *    the previous URL. The hint matters: the localhost default only works in a
 *    simulator on the same Mac as the server — a phone on the same Wi-Fi needs
 *    the Mac's LAN IP.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import {
  isDeviceAnalysisAvailable,
  loadAnalysisBackend,
  resolveBackend,
  saveAnalysisBackend,
  type AnalysisBackend,
} from "./backend";
import { loadServerBaseUrl, saveServerBaseUrl } from "./serverConfig";

const SERVER_HINT =
  "With the server backend, imported videos are analyzed by the RacquetIQ analysis server. " +
  "On a simulator, localhost works as-is; on a phone, use your Mac's LAN IP on the same " +
  "Wi-Fi, e.g. http://192.168.1.20:8082.";

const DEVICE_HINT = "Analysis runs locally — your video never leaves the phone.";
const DEVICE_UNAVAILABLE_HINT =
  "Not available in this build (Expo Go). Use a development build to analyze on-device.";

interface BackendRowProps {
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function BackendRow({ label, hint, icon, selected, disabled = false, onPress }: BackendRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${label}. ${hint}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.textFaint : colors.accent} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
        <Text style={styles.rowHintText}>{hint}</Text>
      </View>
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={selected ? colors.accent : colors.textFaint}
      />
    </Pressable>
  );
}

export function ServerConfigCard() {
  // Availability can't change while Settings is open — sample it once.
  const [deviceAvailable] = useState(isDeviceAnalysisAvailable);
  const [backendSetting, setBackendSetting] = useState<AnalysisBackend>(loadAnalysisBackend);
  const [baseUrl, setBaseUrl] = useState(loadServerBaseUrl);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Show the backend imports will actually use, not a dead stored preference.
  const selectedBackend = resolveBackend(backendSetting, deviceAvailable);

  const chooseBackend = (next: AnalysisBackend) => {
    if (next === "device" && !deviceAvailable) return;
    selectionHaptic();
    if (!saveAnalysisBackend(next)) {
      Alert.alert("Couldn't save", "The analysis setting could not be saved. Try again.");
      return;
    }
    setBackendSetting(next);
  };

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
      <Text style={styles.sectionTitle}>Analysis</Text>
      <BackendRow
        label="On this device (no server needed)"
        hint={deviceAvailable ? DEVICE_HINT : DEVICE_UNAVAILABLE_HINT}
        icon="phone-portrait-outline"
        selected={selectedBackend === "device"}
        disabled={!deviceAvailable}
        onPress={() => chooseBackend("device")}
      />
      <BackendRow
        label="Analysis server"
        hint="Analysis runs on the server configured below."
        icon="server-outline"
        selected={selectedBackend === "server"}
        onPress={() => chooseBackend("server")}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Analysis server URL, ${baseUrl}. Edit`}
        onPress={openEditor}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Ionicons name="globe-outline" size={20} color={colors.accent} />
        <Text style={styles.rowValue} numberOfLines={1}>
          {baseUrl}
        </Text>
        <Ionicons name="pencil-outline" size={16} color={colors.textFaint} />
      </Pressable>
      <Text style={styles.hint}>{SERVER_HINT}</Text>

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
  rowBody: { flex: 1, gap: 2 },
  rowLabel: { ...type.body, color: colors.text },
  rowLabelDisabled: { color: colors.textFaint },
  rowHintText: { ...type.caption, color: colors.textDim, lineHeight: 16 },
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
