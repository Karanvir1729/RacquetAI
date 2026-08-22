import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import { movementProfile, type MovementPoint, type RegionShares } from "./aggregate";
import { formatIsoDay, recordingsWord } from "./display";
import type { PlayerClip } from "./shape";

interface MovementChartProps {
  clips: readonly PlayerClip[];
}

/**
 * Court movement across recordings — the "meta" view the pooled court plan
 * cannot give. One heatmap says where a player stood over every clip added
 * together; this says, recording by recording, how their time split between
 * the front, middle and back thirds of the court and between the left, centre
 * and right, so a coach can see whether someone has drifted deeper over a
 * season or has always lived on one wall. The maths (`movementProfile`) is
 * read off each clip's coverage map and is time-weighted when pooled —
 * measured from player position, like T-time, never inferred.
 *
 * Drawn from Views, no chart library: depth is a row of stacked columns
 * (front at the top, as the court plan draws the front wall at the top);
 * width is a stacked strip per recording. Every mark is `colors.data` at one
 * of three opacities — the calendar's trick — so the chart is one ink and
 * restyles itself with the theme. The three shares of an axis sum to one, so
 * flex IS the share; no scaling needed.
 */

const BAR_W = 22;
const BAR_H = 72;
const BAR_GAP = 8;
const STRIP_H = 10;
const DATE_COL = 52;
/** Front / middle / back and left / centre / right, in that order. */
const BAND_OPACITY = [0.95, 0.6, 0.3] as const;

/** "2026-08-13" → "13 Aug" — formatIsoDay with the year dropped; a column is 22pt wide. */
function shortDate(iso: string): string {
  const parts = formatIsoDay(iso).split(" ");
  return parts.length === 3 ? `${parts[0]} ${parts[1]}` : iso;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function depthLabel(shares: RegionShares): string {
  return `${pct(shares.front)} front, ${pct(shares.middle)} middle, ${pct(shares.back)} back`;
}

function widthLabel(shares: RegionShares): string {
  return `${pct(shares.left)} left, ${pct(shares.centre)} centre, ${pct(shares.right)} right`;
}

function pointName(point: MovementPoint): string {
  const when = formatIsoDay(point.playedAt);
  return point.title.length > 0 ? `${when}, ${point.title}` : when;
}

interface DepthBarProps {
  label: string;
  shares: RegionShares;
  accessibilityLabel: string;
  pooled?: boolean;
}

function DepthBar({ label, shares, accessibilityLabel, pooled = false }: DepthBarProps) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.depthColumn, pooled && styles.depthColumnPooled]}
    >
      <View style={styles.depthBar}>
        <View style={[styles.band, { flex: shares.front, opacity: BAND_OPACITY[0] }]} />
        <View style={[styles.band, { flex: shares.middle, opacity: BAND_OPACITY[1] }]} />
        <View style={[styles.band, { flex: shares.back, opacity: BAND_OPACITY[2] }]} />
      </View>
      <Text style={[styles.depthDate, pooled && styles.depthDatePooled]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

interface WidthStripProps {
  label: string;
  shares: RegionShares;
  accessibilityLabel: string;
  pooled?: boolean;
}

function WidthStrip({ label, shares, accessibilityLabel, pooled = false }: WidthStripProps) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.widthRow}>
      <Text style={[styles.widthDate, pooled && styles.pooledLabel]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.widthStrip}>
        <View style={[styles.band, { flex: shares.left, opacity: BAND_OPACITY[0] }]} />
        <View style={[styles.band, { flex: shares.centre, opacity: BAND_OPACITY[1] }]} />
        <View style={[styles.band, { flex: shares.right, opacity: BAND_OPACITY[2] }]} />
      </View>
    </View>
  );
}

function LegendRow({ labels }: { labels: readonly [string, string, string] }) {
  return (
    <View style={styles.legendRow}>
      {labels.map((label, index) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.swatch, { opacity: BAND_OPACITY[index] ?? 1 }]} />
          <Text style={styles.legendLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export function MovementChart({ clips }: MovementChartProps) {
  const profile = useMemo(() => movementProfile(clips), [clips]);
  const scroller = useRef<ScrollView | null>(null);

  // Open on the recent end, like the calendar: the latest recordings and the
  // pooled column are what a coach reads first. scrollToEnd clamps.
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: false });
  }, [profile]);

  const { points, pooled, clipsWithoutCoverage } = profile;

  if (pooled === null) {
    return (
      <Card style={styles.card}>
        <Text style={styles.heading}>Court movement across recordings</Text>
        <Text style={styles.caption}>
          No court maps in these recordings yet — the movement chart needs the coverage map each
          read-out draws.
        </Text>
      </Card>
    );
  }

  const pooledDepth = `Pooled over ${recordingsWord(points.length)}: ${depthLabel(pooled)}`;
  const pooledWidth = widthLabel(pooled);
  // Clips with no map are counted, not dropped silently (docs/11: silence would
  // claim the chart covers every recording).
  const missing =
    clipsWithoutCoverage === 0
      ? ""
      : clipsWithoutCoverage === 1
        ? " 1 recording carries no court map and is left out."
        : ` ${recordingsWord(clipsWithoutCoverage)} carry no court map and are left out.`;

  return (
    <Card style={styles.card}>
      <View style={styles.intro}>
        <Text style={styles.heading}>Court movement across recordings</Text>
        <Text style={styles.caption}>
          Where their time on court went, recording by recording, from player position. Top = front
          wall.
        </Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Depth</Text>
        <View style={styles.depthBody}>
          {/* Front / back gutter, outside the scroller so it stays put. */}
          <View
            style={styles.depthGutter}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.gutterLabel}>Front</Text>
            <Text style={styles.gutterLabel}>Back</Text>
          </View>
          <ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.depthScroll}
          >
            {points.map((point) => (
              <DepthBar
                key={point.clipId}
                label={shortDate(point.playedAt)}
                shares={point}
                accessibilityLabel={`${pointName(point)}: ${depthLabel(point)}`}
              />
            ))}
            <DepthBar
              pooled
              label="All"
              shares={pooled}
              accessibilityLabel={`All recordings: ${depthLabel(pooled)}`}
            />
          </ScrollView>
        </View>
        <LegendRow labels={["Front", "Middle", "Back"]} />
      </View>

      <View style={styles.divider} />

      <View style={styles.block}>
        <Text style={styles.label}>Width</Text>
        <Text style={styles.caption}>Left to right as the camera sees the court.</Text>
        <View style={styles.widthList}>
          {points.map((point) => (
            <WidthStrip
              key={point.clipId}
              label={shortDate(point.playedAt)}
              shares={point}
              accessibilityLabel={`${pointName(point)}: ${widthLabel(point)}`}
            />
          ))}
          <WidthStrip
            pooled
            label="All"
            shares={pooled}
            accessibilityLabel={`All recordings: ${widthLabel(pooled)}`}
          />
        </View>
        <LegendRow labels={["Left", "Centre", "Right"]} />
      </View>

      <View style={styles.divider} />

      <Text style={styles.caption}>
        {pooledDepth}; {pooledWidth}. They used {pct(pooled.spread)} of the court (cells with at least
        a tenth of their busiest cell&apos;s time).{missing}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  intro: { gap: spacing.xs },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  label: { ...type.label, color: colors.text },
  divider: { height: 1, backgroundColor: colors.line },
  block: { gap: spacing.xs },

  depthBody: { flexDirection: "row", gap: spacing.xs },
  depthGutter: { height: BAR_H, justifyContent: "space-between", width: 30 },
  gutterLabel: { fontSize: 9, fontWeight: "600", color: colors.textDim, textAlign: "right" },
  depthScroll: { flexDirection: "row", alignItems: "flex-end", paddingRight: spacing.xs },
  // The gap lives inside each column (bar centred in BAR_W + BAR_GAP) so the
  // date label underneath has the room a 22pt bar does not.
  depthColumn: { width: BAR_W + BAR_GAP, alignItems: "center", gap: spacing.xs },
  depthColumnPooled: { marginLeft: spacing.sm },
  depthBar: { width: BAR_W, height: BAR_H, borderRadius: 3, overflow: "hidden" },
  depthDate: { fontSize: 9, fontWeight: "600", color: colors.textDim },
  depthDatePooled: { color: colors.text },
  band: { backgroundColor: colors.data },

  widthList: { gap: spacing.xs },
  widthRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  widthDate: { width: DATE_COL, ...type.caption, color: colors.textDim },
  widthStrip: { flex: 1, height: STRIP_H, flexDirection: "row", borderRadius: 3, overflow: "hidden" },
  pooledLabel: { ...type.captionStrong, color: colors.text },

  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  swatch: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.data },
  legendLabel: { fontSize: 10, color: colors.textDim },
});
