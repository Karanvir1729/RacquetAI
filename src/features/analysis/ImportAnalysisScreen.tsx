/**
 * Import & analyze: drives useImportFlow through its stages — upload with
 * progress, server-side preparing, the tap-the-corners step (CornerPicker),
 * analyzing, then persist-and-handoff. On success the screen replaces itself
 * with /analysis?id=<imported id>, so Back from the results returns to the
 * Library, not to a dead progress screen. Errors render a readable message
 * with a retry that restarts the whole flow.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { CornerPicker } from "./CornerPicker";
import { frameUrl } from "./jobContract";
import { useImportFlow, type ImportFlowState } from "./useImportFlow";

interface ImportAnalysisScreenProps {
  /** file:// URI of the picked video; null when the route got no usable param. */
  videoUri: string | null;
}

export function ImportAnalysisScreen({ videoUri }: ImportAnalysisScreenProps) {
  const { state, retry, submitCorners } = useImportFlow(videoUri);

  useEffect(() => {
    if (state.phase === "done") {
      // replace, not push: Back from the analysis must not revisit this flow.
      router.replace({ pathname: "/analysis", params: { id: state.importedId } });
    }
  }, [state]);

  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Library"
        onPress={goBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={18} color={colors.accentText} />
        <Text style={styles.backLabel}>Library</Text>
      </Pressable>
      <ScreenHeader title="Import & analyze" subtitle="Match analysis from an imported video" />
      <View style={styles.body}>
        <FlowStage state={state} retry={retry} submitCorners={submitCorners} />
      </View>
    </Screen>
  );
}

interface FlowStageProps {
  state: ImportFlowState;
  retry: () => void;
  submitCorners: Parameters<typeof CornerPicker>[0]["onSubmit"];
}

function FlowStage({ state, retry, submitCorners }: FlowStageProps) {
  if (state.phase === "failed") {
    return (
      <View style={styles.centerFill}>
        <EmptyState
          icon="cloud-offline-outline"
          iconColor={colors.danger}
          title="Import failed"
          caption={state.message}
        />
        <Button label="Try again" onPress={retry} />
      </View>
    );
  }
  if (state.phase === "job" && state.status.status === "corners_needed") {
    return (
      <CornerPicker frameUri={frameUrl(state.baseUrl, state.jobId)} onSubmit={submitCorners} />
    );
  }
  if (state.phase === "saving" || state.phase === "done") {
    return <LoadingState fill caption="Saving your analysis…" />;
  }

  // Upload or a server-side stage: the step list with live progress.
  const uploading = state.phase === "uploading";
  const status = uploading ? null : state.status;
  const stepIndex = uploading
    ? 0
    : status?.status === "queued" || status?.status === "preparing"
      ? 1
      : 3;
  const progressPct = uploading
    ? state.progress === null
      ? null
      : state.progress * 100
    : (status?.progressPct ?? null);
  return (
    <View style={styles.centerFill}>
      <View style={styles.steps}>
        {STEPS.map((label, index) => (
          <View key={label} style={styles.stepRow}>
            <Ionicons
              name={
                index < stepIndex
                  ? "checkmark-circle"
                  : index === stepIndex
                    ? "ellipse"
                    : "ellipse-outline"
              }
              size={16}
              color={index <= stepIndex ? colors.accent : colors.textFaint}
            />
            <Text style={[styles.stepLabel, index === stepIndex && styles.stepLabelActive]}>
              {label}
              {index === stepIndex && progressPct !== null ? ` · ${Math.round(progressPct)}%` : ""}
            </Text>
          </View>
        ))}
      </View>
      <ProgressBar pct={progressPct} />
      {status?.message ? <Text style={styles.serverMessage}>{status.message}</Text> : null}
    </View>
  );
}

const STEPS = ["Uploading video…", "Preparing video…", "Mark the court corners", "Analyzing…"];

function ProgressBar({ pct }: { pct: number | null }) {
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          { width: pct === null ? "12%" : `${Math.min(100, Math.max(0, pct))}%` },
          pct === null && styles.fillIndeterminate,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  backLabel: { ...type.label, color: colors.accentText },
  body: { flex: 1, padding: spacing.md },
  centerFill: { flex: 1, justifyContent: "center", gap: spacing.lg },
  steps: { gap: spacing.sm, alignSelf: "center" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepLabel: { ...type.body, color: colors.textFaint },
  stepLabelActive: { ...type.bodyStrong, color: colors.text },
  serverMessage: { ...type.caption, color: colors.textDim, textAlign: "center" },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  fill: { flex: 1, borderRadius: radius.pill, backgroundColor: colors.accent },
  fillIndeterminate: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
