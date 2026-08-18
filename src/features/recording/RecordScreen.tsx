import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingState } from "@/components/LoadingState";
import { notifySuccess, tapMedium } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { CameraUnavailable, PermissionGate } from "./PermissionGate";
import { ElapsedBadge, FlipButton, RecordButton } from "./RecordControls";
import { saveRecording } from "./storage";

/** Keep-awake tag scoped to capture so other holds (if any appear) are unaffected. */
const KEEP_AWAKE_TAG = "recording";

type Phase = "idle" | "recording" | "saving";

/**
 * The Record tab: full-screen camera with overlaid controls. Owns the whole
 * capture lifecycle — permissions, keep-awake while filming, the elapsed
 * timer, and handing the finished take to storage.saveRecording. The screen
 * manages its own layout (no <Screen> wrapper): the preview runs under the
 * status bar by design, and only the controls respect safe-area insets.
 */
export function RecordScreen() {
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [cameraReady, setCameraReady] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  // Camera stays powered only while this tab is focused (battery + privacy).
  const [focused, setFocused] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Unmount safety net: never leave the screen-sleep lock or timer behind.
  useEffect(
    () => () => {
      stopTimer();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    },
    [stopTimer],
  );

  const startRecording = async () => {
    const camera = cameraRef.current;
    if (camera === null || phase !== "idle") return;
    tapMedium();
    setPhase("recording");
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    const startedAt = Date.now();
    setElapsedSec(0);
    timerRef.current = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );
    try {
      // Resolves when stopRecording() is called or the preview stops
      // (tab switch unfocuses the camera) — both are valid ends of a take.
      const video = await camera.recordAsync();
      stopTimer();
      if (video?.uri) {
        setPhase("saving");
        saveRecording({
          sourceUri: video.uri,
          durationSec: (Date.now() - startedAt) / 1000,
          sport: "squash",
        });
        notifySuccess();
      }
    } catch {
      stopTimer();
      Alert.alert("Recording failed", "The take couldn't be captured or saved. Please try again.");
    } finally {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      setElapsedSec(0);
      setPhase("idle");
    }
  };

  const stopRecording = () => {
    tapMedium();
    cameraRef.current?.stopRecording();
  };

  // ----- Gate states (hooks above always run, so early returns are safe) -----
  if (cameraPermission === null || micPermission === null) {
    return <LoadingState fill />;
  }
  if (!cameraPermission.granted || !micPermission.granted) {
    const canAskAgain =
      (cameraPermission.granted || cameraPermission.canAskAgain) &&
      (micPermission.granted || micPermission.canAskAgain);
    return (
      <PermissionGate
        canAskAgain={canAskAgain}
        onRequest={() => {
          void (async () => {
            // Sequential, not parallel: two stacked system prompts confuse iOS.
            if (!cameraPermission.granted) await requestCameraPermission();
            if (!micPermission.granted) await requestMicPermission();
          })();
        }}
      />
    );
  }
  if (mountFailed) {
    return <CameraUnavailable />;
  }

  const recording = phase === "recording";
  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
        active={focused}
        onCameraReady={() => setCameraReady(true)}
        onMountError={() => setMountFailed(true)}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.md }]}>
        {recording ? <ElapsedBadge elapsedSec={elapsedSec} /> : null}
        <View style={styles.spacer} />
        {phase === "saving" ? <Text style={styles.saving}>Saving…</Text> : null}
        <View style={styles.controls}>
          <FlipButton
            disabled={recording || phase === "saving"}
            onPress={() => setFacing((current) => (current === "back" ? "front" : "back"))}
          />
          <RecordButton
            recording={recording}
            disabled={!cameraReady || phase === "saving"}
            onPress={recording ? stopRecording : () => void startRecording()}
          />
          {/* Mirrors the flip button's width so the record button stays centred. */}
          <View style={styles.controlsSpacer} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { flex: 1, paddingBottom: spacing.lg },
  spacer: { flex: 1 },
  saving: {
    ...type.label,
    color: colors.text,
    alignSelf: "center",
    marginBottom: spacing.md,
    backgroundColor: colors.chip,
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  controlsSpacer: { width: 52 },
});
