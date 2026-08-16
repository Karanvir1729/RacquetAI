import * as Linking from "expo-linking";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { FORM_MAX_WIDTH, column } from "@/theme/layout";
import { colors, spacing } from "@/theme/tokens";

interface PermissionGateProps {
  /** False once the OS will no longer show the prompt — the fix moves to Settings. */
  canAskAgain: boolean;
  onRequest: () => void;
}

/**
 * Camera/microphone permission states for the Record tab: a first-run explain
 * + request, and the denied state whose only remaining path is the system
 * Settings screen (the OS stops re-prompting after a denial).
 */
export function PermissionGate({ canAskAgain, onRequest }: PermissionGateProps) {
  return (
    <Screen>
      <ScreenHeader title="Record" subtitle="Match capture" />
      <View style={styles.body}>
        <EmptyState
          icon={canAskAgain ? "videocam-outline" : "videocam-off-outline"}
          iconColor={canAskAgain ? colors.accent : colors.danger}
          title={canAskAgain ? "Camera & microphone access" : "Camera access is off"}
          caption={
            canAskAgain
              ? "RacquetIQ films your matches with sound so you can review every rally. Nothing leaves your device."
              : "Recording needs the camera and microphone. Turn both on for RacquetIQ in Settings to start filming."
          }
        />
        <View style={styles.action}>
          {canAskAgain ? (
            <Button label="Allow camera & microphone" onPress={onRequest} />
          ) : (
            <Button
              label="Open Settings"
              variant="secondary"
              onPress={() => {
                // Guarded: openSettings can reject on exotic Android builds.
                Linking.openSettings().catch(() => {});
              }}
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

/** Shown when the camera fails to mount — most commonly the iOS Simulator, which has none. */
export function CameraUnavailable() {
  return (
    <Screen>
      <ScreenHeader title="Record" subtitle="Match capture" />
      <View style={styles.body}>
        <EmptyState
          icon="videocam-off-outline"
          iconColor={colors.textFaint}
          title="No camera on this device"
          caption="This device doesn't have a usable camera — the iOS Simulator, for instance, has none. Run RacquetIQ on a real phone to record matches."
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: "center", padding: spacing.md, gap: spacing.lg },
  action: { ...column(FORM_MAX_WIDTH) },
});
