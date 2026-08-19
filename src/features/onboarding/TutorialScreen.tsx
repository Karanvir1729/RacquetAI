/**
 * The first-run tutorial: one full-screen page per step, swiped horizontally,
 * with the pager and the buttons kept in sync.
 *
 * Rendered INSTEAD of the tab shell (see src/app/_layout.tsx) rather than as a
 * route, so there is no tab bar to escape through and no history to go back
 * into — the only ways out are Skip and finishing, both of which record the
 * flag. It is also reachable again from the Library, so this component must
 * not assume it is a first run.
 */
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { selection as selectionHaptic } from "@/lib/haptics";
import { column, CONTENT_MAX_WIDTH } from "@/theme/layout";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { TUTORIAL_STEPS, type TutorialStep } from "./steps";

interface TutorialScreenProps {
  /** Called once the user finishes or skips; the caller owns persisting that. */
  onDone: () => void;
}

export function TutorialScreen({ onDone }: TutorialScreenProps) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = TUTORIAL_STEPS.length - 1;
  // A page is as wide as the capped column, not the window — the pager lives
  // inside that column on iPad (layout.ts / ADR-002), so paging off the raw
  // window width would land every swipe between two steps.
  const pageWidth = Math.min(width, CONTENT_MAX_WIDTH);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), last);
      selectionHaptic();
      // Drive the scroll; onMomentumScrollEnd reconciles `index` either way,
      // so a programmatic jump and a swipe cannot disagree.
      scrollRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
      setIndex(clamped);
    },
    [last, pageWidth],
  );

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Guard against a zero width on the very first layout pass.
      if (pageWidth <= 0) return;
      const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      setIndex(Math.min(Math.max(next, 0), last));
    },
    [last, pageWidth],
  );

  // Rotating an iPad or resizing a Split View changes the page width under a
  // scroll offset that was measured against the old one, which leaves the pager
  // parked between two steps. Re-anchor on the current step when it changes —
  // and only then, or this would fight the animated scroll in goTo.
  const anchoredWidth = useRef(pageWidth);
  useEffect(() => {
    if (anchoredWidth.current === pageWidth || pageWidth <= 0) return;
    anchoredWidth.current = pageWidth;
    scrollRef.current?.scrollTo({ x: index * pageWidth, animated: false });
  }, [index, pageWidth]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.column}>
        <View style={styles.topBar}>
          <Text style={styles.progress}>
            {index + 1} of {TUTORIAL_STEPS.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip the tutorial"
            onPress={onDone}
            hitSlop={spacing.sm}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          style={styles.pager}
        >
          {TUTORIAL_STEPS.map((step) => (
            <StepPage key={step.title} step={step} width={pageWidth} />
          ))}
        </ScrollView>

        <View style={styles.dots}>
          {TUTORIAL_STEPS.map((step, i) => (
            <View key={step.title} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.actions}>
          {index > 0 ? (
            <View style={styles.actionSlot}>
              <Button label="Back" variant="secondary" onPress={() => goTo(index - 1)} />
            </View>
          ) : null}
          <View style={styles.actionSlot}>
            <Button
              label={index === last ? "Start analysing" : "Next"}
              onPress={index === last ? onDone : () => goTo(index + 1)}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function StepPage({ step, width }: { step: TutorialStep; width: number }) {
  return (
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.mark}>
        <Ionicons name={step.icon} size={30} color={colors.onAccent} />
      </View>
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.lead}>{step.lead}</Text>

      <View style={styles.points}>
        {step.points.map((point) => (
          <View key={point} style={styles.point}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.accentText}
              style={styles.pointIcon}
            />
            <Text style={styles.pointText}>{point}</Text>
          </View>
        ))}
      </View>

      {step.caution ? (
        <View style={styles.caution}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} style={styles.pointIcon} />
          <Text style={styles.cautionText}>{step.caution}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  column: { ...column(CONTENT_MAX_WIDTH), flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  progress: { ...type.caption, color: colors.textDim },
  skip: { minHeight: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: spacing.xs },
  skipLabel: { ...type.label, color: colors.accentText },
  pager: { flex: 1 },
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...type.title, color: colors.text },
  lead: { ...type.body, color: colors.textDim, lineHeight: 22 },
  points: { gap: spacing.sm, marginTop: spacing.xs },
  point: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  // Nudged down so the glyph sits on the first line's baseline, not above it.
  pointIcon: { marginTop: 1 },
  pointText: { ...type.body, color: colors.text, flex: 1, lineHeight: 22 },
  caution: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  cautionText: { ...type.caption, color: colors.text, flex: 1, lineHeight: 18 },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.line2 },
  dotActive: { backgroundColor: colors.accent, width: 20 },
  actions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  actionSlot: { flex: 1 },
  pressed: { opacity: 0.7 },
});
