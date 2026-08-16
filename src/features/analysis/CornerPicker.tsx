/**
 * "Mark the court corners" stage: the server's mid-video reference frame with
 * four taps on the FLOOR corners, in the contract's order (Front left → Front
 * right → Back left → Back right). Taps are measured in view space and mapped
 * through letterbox.ts to normalized 0..1 frame coordinates — the image
 * renders `contain`, so the letterbox bars are dead zones, not court. Markers
 * render back through the inverse mapping, so what the user sees is exactly
 * what the server receives.
 */
import { Image, type ImageLoadEventData } from "expo-image";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { Button } from "@/components/Button";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, radius, spacing, type } from "@/theme/tokens";

import { cellLabel } from "./format";
import { CORNER_ORDER, type CourtCorners } from "./jobContract";
import { normalizedToView, tapToNormalized, type Point, type Size } from "./letterbox";

const MARKER_SIZE = 28;

interface CornerPickerProps {
  /** GET /jobs/{id}/frame.jpg on the configured server. */
  frameUri: string;
  /** POST the corners; resolves false when the request failed. */
  onSubmit: (corners: CourtCorners) => Promise<boolean>;
}

export function CornerPicker({ frameUri, onSubmit }: CornerPickerProps) {
  const [boxSize, setBoxSize] = useState<Size | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  /** Placed corners in CORNER_ORDER, as normalized frame coordinates. */
  const [points, setPoints] = useState<Point[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const ready = boxSize !== null && imageSize !== null;
  const nextCell = points.length < CORNER_ORDER.length ? CORNER_ORDER[points.length] : null;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBoxSize({ width, height });
  };

  const handleLoad = (event: ImageLoadEventData) => {
    setImageSize({ width: event.source.width, height: event.source.height });
  };

  const handleTap = (tap: Point) => {
    if (!ready || nextCell === null || submitting) return;
    const normalized = tapToNormalized(tap, boxSize, imageSize);
    if (normalized === null) return; // letterbox bar — not court
    selectionHaptic();
    setPoints((current) => [...current, normalized]);
  };

  const confirm = async () => {
    if (points.length !== CORNER_ORDER.length) return;
    const corners = {} as CourtCorners;
    CORNER_ORDER.forEach((cell, index) => {
      corners[cell] = points[index];
    });
    setSubmitting(true);
    const ok = await onSubmit(corners);
    setSubmitting(false);
    if (!ok) {
      Alert.alert(
        "Couldn't send corners",
        "The analysis server didn't accept the corners. Check the connection and try again.",
      );
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Mark the court corners</Text>
      <Text style={styles.instruction}>
        {nextCell !== null
          ? `Tap the ${cellLabel(nextCell).toLowerCase()} FLOOR corner (${points.length + 1} of 4).`
          : "All four corners placed — confirm to start the analysis."}
      </Text>
      <View style={styles.frameBox} onLayout={handleLayout}>
        <Image
          source={{ uri: frameUri }}
          style={styles.frame}
          contentFit="contain"
          onLoad={handleLoad}
          accessibilityLabel="Reference frame from your match video"
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="image"
          accessibilityLabel="Court frame. Tap the four floor corners in order: front left, front right, back left, back right."
          onPress={(event) =>
            handleTap({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY })
          }
        />
        {ready
          ? points.map((point, index) => {
              const at = normalizedToView(point, boxSize, imageSize);
              if (at === null) return null;
              return (
                <View
                  key={CORNER_ORDER[index]}
                  pointerEvents="none"
                  style={[
                    styles.marker,
                    { left: at.x - MARKER_SIZE / 2, top: at.y - MARKER_SIZE / 2 },
                  ]}
                >
                  <Text style={styles.markerLabel}>{index + 1}</Text>
                </View>
              );
            })
          : null}
      </View>
      <View style={styles.buttons}>
        <View style={styles.buttonFlex}>
          <Button
            label="Reset"
            variant="secondary"
            disabled={points.length === 0 || submitting}
            onPress={() => setPoints([])}
          />
        </View>
        <View style={styles.buttonFlex}>
          <Button
            label="Confirm corners"
            loading={submitting}
            disabled={points.length !== CORNER_ORDER.length}
            onPress={() => void confirm()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.sm },
  title: { ...type.heading, color: colors.text },
  instruction: { ...type.caption, color: colors.textDim, lineHeight: 18 },
  frameBox: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  frame: { flex: 1 },
  marker: {
    position: "absolute",
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.onAccent,
    alignItems: "center",
    justifyContent: "center",
  },
  markerLabel: { ...type.captionStrong, color: colors.onAccent },
  buttons: { flexDirection: "row", gap: spacing.sm },
  buttonFlex: { flex: 1 },
});
