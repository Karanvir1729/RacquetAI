/**
 * Where analysis runs: this iPhone, or an analysis server. The Account tab
 * hosts it (the app's one settings surface), the analysis feature owns it —
 * every value it touches lives in this folder's sidecars, and the next
 * import reads them fresh (useImportFlow resolves engine + URL per run).
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Card } from "@/components/Card";
import { Segmented } from "@/components/Segmented";
import { trackEvent } from "@/lib/appEvents";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import {
  isDeviceAnalysisAvailable,
  loadAnalysisBackend,
  saveAnalysisBackend,
  type AnalysisBackend,
} from "./backend";
import { DEFAULT_SERVER_BASE_URL } from "./jobContract";
import { loadServerBaseUrl, saveServerBaseUrl } from "./serverConfig";

const LOCAL_MAC_URL = "http://localhost:8082";

const ENGINE_OPTIONS = [
  { key: "device", label: "This iPhone" },
  { key: "server", label: "Server" },
] as const;

export function EngineSettingsCard() {
  const [backend, setBackend] = useState<AnalysisBackend>(loadAnalysisBackend);
  const [serverUrl, setServerUrl] = useState<string>(loadServerBaseUrl);
  const [deviceAvailable] = useState<boolean>(isDeviceAnalysisAvailable);

  function chooseBackend(next: AnalysisBackend) {
    setBackend(next);
    saveAnalysisBackend(next);
    trackEvent("engine_changed", { backend: next });
  }

  function commitServerUrl(input: string) {
    const inForce = saveServerBaseUrl(input);
    setServerUrl(inForce);
  }

  return (
    <Card>
      <Text style={styles.title}>Analysis engine</Text>
      <Text style={styles.dim}>
        On-device keeps footage on the phone but can be slow. A server does the heavy lifting
        instead — the cloud one, or a Mac on your network running the analysis server.
      </Text>

      <Segmented
        options={ENGINE_OPTIONS}
        value={backend}
        onChange={(key) => chooseBackend(key)}
      />

      {backend === "device" && !deviceAvailable ? (
        <Text style={styles.dim}>
          This build can{"’"}t analyze on-device, so the server engine is used either way.
        </Text>
      ) : null}

      {backend === "server" ? (
        <>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            onEndEditing={(event) => commitServerUrl(event.nativeEvent.text)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Analysis server URL"
          />
          <View style={styles.presets}>
            <PresetChip
              label="Cloud server"
              active={serverUrl === DEFAULT_SERVER_BASE_URL}
              onPress={() => commitServerUrl(DEFAULT_SERVER_BASE_URL)}
            />
            <PresetChip
              label="This Mac (simulator)"
              active={serverUrl === LOCAL_MAC_URL}
              onPress={() => commitServerUrl(LOCAL_MAC_URL)}
            />
          </View>
          <Text style={styles.dim}>
            A phone on your Wi-Fi reaches a Mac{"’"}s server at the Mac{"’"}s LAN
            address, not localhost.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function PresetChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { ...type.heading, color: colors.text },
  dim: { ...type.caption, color: colors.textDim },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardRaised,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...type.body,
  },
  presets: { flexDirection: "row", gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.cardRaised,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipLabel: { ...type.label, color: colors.textDim },
  chipLabelActive: { color: colors.accentText },
  pressed: { opacity: 0.7 },
});
