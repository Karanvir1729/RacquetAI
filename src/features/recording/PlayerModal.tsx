import { Ionicons } from "@expo/vector-icons";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { formatBytes, formatClock } from "@/lib/format";
import { notifySuccess, selection as selectionHaptic } from "@/lib/haptics";
import { column, FORM_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { formatRecordedAt, sportLabel } from "./display";
import type { RecordingEntry } from "./types";

interface PlayerModalProps {
  entry: RecordingEntry;
  onClose: () => void;
}

type ExportState = "idle" | "saving" | "saved";

/**
 * Full-screen playback over the Library, as a modal rather than a router
 * screen: the tab shell lives in the root layout, and a new route file would
 * surface there as a fifth tab. expo-video's native controls handle
 * scrub/seek/fullscreen; the footer adds the explicit save-to-Photos escape
 * hatch so footage is never locked inside the app sandbox.
 */
export function PlayerModal({ entry, onClose }: PlayerModalProps) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(entry.videoUri, (instance) => {
    instance.play();
  });
  const [exportState, setExportState] = useState<ExportState>("idle");

  const saveToPhotos = async () => {
    setExportState("saving");
    try {
      // Write-only access: adding one video needs no library-read grant.
      const permission = await requestPermissionsAsync(true);
      if (!permission.granted) {
        setExportState("idle");
        Alert.alert(
          "Photos access needed",
          "Allow RacquetIQ to add to your photo library in Settings, then try again.",
        );
        return;
      }
      await Asset.create(entry.videoUri);
      notifySuccess();
      setExportState("saved");
    } catch {
      setExportState("idle");
      Alert.alert("Couldn't save", "The video could not be saved to Photos.");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View
        style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md }]}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close player"
            onPress={() => {
              selectionHaptic();
              onClose();
            }}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-down" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {formatRecordedAt(entry.meta.createdAt)}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {formatClock(entry.meta.durationSec)} · {formatBytes(entry.sizeBytes)} ·{" "}
              {sportLabel(entry.meta.sport)}
            </Text>
          </View>
          {/* Mirrors the close button so the title block stays centred. */}
          <View style={styles.closeSpacer} />
        </View>
        {/* Native controls carry scrub/seek and the fullscreen button (enabled by default). */}
        <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
        <View style={styles.footer}>
          <Button
            label={exportState === "saved" ? "Saved to Photos" : "Save to Photos"}
            variant="secondary"
            loading={exportState === "saving"}
            disabled={exportState !== "idle"}
            onPress={() => void saveToPhotos()}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  closeSpacer: { width: MIN_TOUCH_TARGET },
  titleBlock: { flex: 1, alignItems: "center", gap: 2 },
  title: { ...type.bodyStrong, color: colors.text },
  subtitle: { ...type.caption, color: colors.textDim },
  video: { flex: 1, backgroundColor: colors.bg },
  footer: { ...column(FORM_MAX_WIDTH), paddingHorizontal: spacing.md, paddingTop: spacing.md },
  pressed: { opacity: 0.7 },
});
