import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { hasAnalysisSidecar } from "@/lib/analysisSidecar";
import { formatClock } from "@/lib/format";
import { notifyWarning } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { cellLabel, formatPercent, heatOpacity, prettyPattern } from "../analysis/format";
import { COURT_CELLS, type CoverageHeatmap, type Placement } from "../analysis/types";
import { sortChronologically } from "./aggregate";
import { formatIsoDay } from "./display";
import type { ClipSummary, PlayerClip } from "./shape";
import { mediaUrl } from "./store";

interface RecordingsListProps {
  playerId: string;
  playerName: string;
  clips: readonly PlayerClip[];
  /** Returns an error message, or null when the untag landed. */
  onUntag: (clipId: string) => Promise<string | null>;
}

/**
 * Every recording this player was named on, as a feed: one card per clip,
 * newest first (the aggregate sorts oldest first for the maths), a poster on
 * top and the clip's own figures under it — the shape of a video feed,
 * because "which match was that" is answered by a picture long before it is
 * answered by a title. Every claim above can be traced to the clips here.
 *
 * What the poster is depends on what travelled with the tag. A frame — the
 * one still kept when the clip was tagged on the machine that had the
 * footage — when there is one; otherwise the clip's court plan, drawn from
 * its stored coverage. Each wears a corner label saying which, and a frame's
 * spoken label says "still", never "video": the footage stayed where it was
 * analysed.
 *
 * "Show detailed analysis" goes to the fullest read-out that exists for this
 * clip on THIS phone: the recording's own analysis screen when its sidecar is
 * here (with the video, if the phone kept one), else the stored analysis
 * (pose track stripped, poster in place of the video), else the numbers the
 * tag kept, opened in place — a clip tagged before analyses were stored has
 * only its summary, and the card says so rather than opening nothing.
 *
 * Remove takes the name off the clip — the analysis itself stays wherever it
 * was recorded — behind the app's Alert confirm, as before.
 *
 * Cross-feature imports, documented (docs/01 rule 2): the court plan is tinted
 * with the read-out's own `heatOpacity` ramp and the numbers are worded with
 * its format helpers, so a poster drawn from the data and a read-out's own
 * heat map read as one thing.
 *
 * Over the ~300-line guide (docs/01 rule 5) on purpose: the poster, the
 * court-plan fallback and the numbers disclosure are this feed's own
 * pieces, read together; the detail screen reuses the poster from here.
 */
export function RecordingsList({ playerId, playerName, clips, onUntag }: RecordingsListProps) {
  const recent = useMemo(() => sortChronologically(clips).reverse(), [clips]);
  // Which clips' analyses are on this phone: the sidecar `exists` check the
  // Library runs per row, done once per clips change rather than per render.
  const onPhone = useMemo(() => {
    const ids = new Set<string>();
    for (const clip of clips) {
      if (clip.historyId !== null && hasAnalysisSidecar(clip.historyId)) ids.add(clip.historyId);
    }
    return ids;
  }, [clips]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const minutes = Math.round(clips.reduce((sum, clip) => sum + clip.durationSec, 0) / 60);

  const confirmUntag = (clip: PlayerClip) => {
    const title = clip.title.length > 0 ? clip.title : "this recording";
    notifyWarning();
    Alert.alert(
      `Remove ${title} from ${playerName}?`,
      "The analysis stays in your library; only the name comes off.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setBusy(clip.id);
            setFailure(null);
            void onUntag(clip.id).then((message) => {
              setBusy(null);
              if (message !== null) setFailure(message);
            });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Recordings</Text>
        <Text style={styles.caption}>
          {clips.length} {clips.length === 1 ? "clip" : "clips"} · {minutes} min
        </Text>
      </View>
      <Text style={styles.caption}>
        Newest first. A still is one frame kept when the clip was tagged; the footage itself
        stays on the machine that analysed it.
      </Text>
      {failure !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {failure}
        </Text>
      ) : null}
      {recent.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          playerId={playerId}
          playerName={playerName}
          inLibrary={clip.historyId !== null && onPhone.has(clip.historyId)}
          working={busy === clip.id}
          onRemove={() => confirmUntag(clip)}
        />
      ))}
    </View>
  );
}

interface ClipCardProps {
  clip: PlayerClip;
  playerId: string;
  playerName: string;
  inLibrary: boolean;
  working: boolean;
  onRemove: () => void;
}

function ClipCard({ clip, playerId, playerName, inLibrary, working, onRemove }: ClipCardProps) {
  const { me, opponent } = clip.summary;
  const title = clip.title.length > 0 ? clip.title : "Untitled recording";
  // The fullest read-out there is for this clip, here, in order of fullness.
  const detail: "library" | "stored" | "numbers" =
    inLibrary && clip.historyId !== null
      ? "library"
      : clip.analysisPath !== null
        ? "stored"
        : "numbers";
  const [numbersOpen, setNumbersOpen] = useState(false);

  const open = () => {
    if (detail === "library" && clip.historyId !== null) {
      router.push({ pathname: "/analysis", params: { id: clip.historyId } });
    } else if (detail === "stored") {
      router.push({ pathname: "/clip/[id]", params: { id: clip.id, player: playerId } });
    } else {
      setNumbersOpen((current) => !current);
    }
  };

  return (
    <Card style={styles.card}>
      <ClipPoster clip={clip} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {detail === "numbers" ? (
          <Text style={styles.caption}>
            Numbers only — this clip was tagged before stills and analyses were kept.
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={2}>
          {formatIsoDay(clip.playedAt)} · as {me.label} · {clip.shots}{" "}
          {clip.shots === 1 ? "shot" : "shots"}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          T-time {me.tTimePct.toFixed(0)}% · predictability{" "}
          {Math.round(me.predictability.score * 100)}%
          {opponent !== null ? ` · opponent T-time ${opponent.tTimePct.toFixed(0)}%` : ""}
        </Text>
      </View>
      <View style={styles.actions}>
        <View style={styles.primary}>
          <Button
            variant="secondary"
            label={
              detail === "numbers"
                ? numbersOpen
                  ? "Hide the numbers"
                  : "Show the numbers"
                : "Show detailed analysis"
            }
            accessibilityLabel={
              detail === "numbers"
                ? `${numbersOpen ? "Hide" : "Show"} the numbers kept for ${title}`
                : `Show detailed analysis for ${title}`
            }
            onPress={open}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${title} from ${playerName}`}
          accessibilityState={{ disabled: working }}
          disabled={working}
          hitSlop={spacing.sm}
          onPress={onRemove}
          style={({ pressed }) => [
            styles.rowAction,
            pressed && styles.pressed,
            working && styles.disabled,
          ]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      </View>
      {detail === "numbers" && numbersOpen ? <NumbersOnly summary={clip.summary} /> : null}
    </Card>
  );
}

/**
 * The picture on a card: the kept still when there is one (and it loads — a
 * path whose object is gone draws the court plan, never a broken image),
 * else the court plan from the clip's own coverage, else its placement
 * quadrants. A corner label names the kind; the duration sits opposite.
 * Exported for the detail screen, which puts the same poster where the video
 * would be.
 */
export function ClipPoster({ clip }: { clip: PlayerClip }) {
  const [broken, setBroken] = useState(false);
  const title = clip.title.length > 0 ? clip.title : "this recording";
  const poster = clip.posterPath !== null && !broken ? mediaUrl(clip.posterPath) : null;
  const { me } = clip.summary;
  const kind = poster !== null ? "Still" : me.coverage !== null ? "Court plan" : "Placement";

  return (
    <View style={styles.posterBox}>
      {poster !== null ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onError={() => setBroken(true)}
        />
      ) : me.coverage !== null ? (
        <CourtPlanPoster
          coverage={me.coverage}
          label={`Court plan of where ${me.label} spent their time in ${title}`}
        />
      ) : (
        <PlacementPoster
          placement={me.placement}
          label={`Where ${me.label}'s shots were retrieved in ${title}`}
        />
      )}
      <View style={[styles.chip, styles.chipTopLeft]} pointerEvents="none">
        <Text style={styles.chipLabel}>{kind}</Text>
      </View>
      <View style={[styles.chip, styles.chipBottomRight]} pointerEvents="none">
        <Text style={styles.chipValue}>{formatClock(clip.durationSec)}</Text>
      </View>
    </View>
  );
}

/**
 * The clip's coverage as a court plan on the floor: the same 8x12 cells the
 * read-out's CoverageGrid tints (same data token, same heatOpacity ramp, row 0
 * at the top = front wall, short line at 5.44 m of 9.75 m), drawn to fit a
 * 16:9 box — the court is taller than it is wide, so height is the constraint
 * and the width follows from the court's own 2:3 footprint.
 */
function CourtPlanPoster({ coverage, label }: { coverage: CoverageHeatmap; label: string }) {
  const rows = Array.from({ length: coverage.rows }, (_, row) =>
    coverage.values.slice(row * coverage.cols, (row + 1) * coverage.cols),
  );
  return (
    <View style={styles.floor} accessible accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.court}>
        {rows.map((values, rowIndex) => (
          <View key={rowIndex} style={styles.planRow}>
            {values.map((value, colIndex) => (
              <View key={colIndex} style={[styles.planCell, { opacity: heatOpacity(value) }]} />
            ))}
          </View>
        ))}
        <View pointerEvents="none" style={styles.shortLine} />
      </View>
    </View>
  );
}

/** The placement quadrants in the same footprint: each tinted by its share, with its count. */
function PlacementPoster({ placement, label }: { placement: Placement; label: string }) {
  const most = Math.max(1, ...COURT_CELLS.map((cell) => placement[cell]));
  const quadrantRows = [
    ["frontLeft", "frontRight"],
    ["backLeft", "backRight"],
  ] as const;
  return (
    <View style={styles.floor} accessible accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.court}>
        {quadrantRows.map((row) => (
          <View key={row[0]} style={styles.planRow}>
            {row.map((cell) => (
              <View key={cell} style={styles.quadrant}>
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.planCell,
                    { opacity: heatOpacity(placement[cell] / most) },
                  ]}
                />
                <Text style={styles.quadrantCount}>{placement[cell]}</Text>
              </View>
            ))}
          </View>
        ))}
        <View pointerEvents="none" style={styles.shortLine} />
      </View>
    </View>
  );
}

/**
 * What the tag kept, opened in place, for a clip with no read-out to go to:
 * the summary's key numbers, worded as the read-out words them.
 */
function NumbersOnly({ summary }: { summary: ClipSummary }) {
  const { me, opponent, rallies, quality } = summary;
  // tTimePct and bothPlayersDetectedPct are already 0..100 per the contract.
  const placement = COURT_CELLS.map((cell) => {
    const share = formatPercent(me.shots > 0 ? me.placement[cell] / me.shots : 0);
    return `${cellLabel(cell)} ${me.placement[cell]} (${share})`;
  }).join(" · ");
  const lines = [
    `${me.shots} shots · at the T ${formatPercent(me.tTimePct / 100)} of the time · ` +
      `predictability ${formatPercent(me.predictability.score)}`,
    me.predictability.topPattern.length > 0
      ? `Top pattern: ${prettyPattern(me.predictability.topPattern)}`
      : null,
    `Placement (where shots were retrieved): ${placement}`,
    `${rallies.count} rallies · ${rallies.avgShotsPerRally.toFixed(1)} shots per rally · ` +
      `longest ${rallies.longestRally}`,
    opponent !== null
      ? `Opponent: ${opponent.shots} shots · T-time ${opponent.tTimePct.toFixed(0)}% · ` +
        `predictability ${formatPercent(opponent.predictability.score)}`
      : null,
    `${quality.framesAnalyzed} frames analysed · both players detected in ` +
      `${formatPercent(quality.bothPlayersDetectedPct / 100)} of them`,
  ];
  return (
    <View style={styles.numbers}>
      {lines.map((line) =>
        line === null ? null : (
          <Text key={line} style={styles.numbersLine}>
            {line}
          </Text>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  error: { ...type.caption, color: colors.danger },
  card: { gap: spacing.sm },
  posterBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    overflow: "hidden",
  },
  // The floor under a data-drawn poster; the court sits centred on it.
  floor: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  court: {
    height: "84%",
    aspectRatio: 2 / 3,
    padding: 2,
    gap: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.panel,
  },
  planRow: { flex: 1, flexDirection: "row", gap: 2 },
  // Data marks, not surfaces: `data`, like the read-out's heat cells.
  planCell: { flex: 1, borderRadius: 2, backgroundColor: colors.data },
  quadrant: { flex: 1, alignItems: "center", justifyContent: "center" },
  quadrantCount: { ...type.label, color: colors.text },
  shortLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "55.8%",
    height: 1,
    backgroundColor: colors.line2,
  },
  chip: {
    position: "absolute",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.chip,
  },
  chipTopLeft: { top: spacing.sm, left: spacing.sm },
  chipBottomRight: { bottom: spacing.sm, right: spacing.sm },
  chipLabel: { ...type.captionStrong, color: colors.text },
  chipValue: { ...type.captionStrong, color: colors.text, fontVariant: ["tabular-nums"] },
  text: { gap: 2 },
  title: { ...type.bodyStrong, color: colors.text },
  meta: { ...type.caption, color: colors.textDim },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  primary: { flex: 1 },
  rowAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  numbers: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  numbersLine: { ...type.caption, color: colors.textDim },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
