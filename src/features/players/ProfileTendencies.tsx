import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { colors, spacing, type } from "@/theme/tokens";

import { CoverageGrid } from "../analysis/CoverageGrid";
import { formatPercent, formatShotTypeBreakdown, prettyPattern } from "../analysis/format";
import { PlacementGrid } from "../analysis/PlacementGrid";
import type { ProfileStats } from "./aggregate";
import { shotTypeCounts } from "./display";
import { StatTile } from "./StatTile";

interface ProfileTendenciesProps {
  stats: ProfileStats;
}

/** "+4 pts vs opponents" — a real minus sign, and no colour: a delta is a fact, not a verdict. */
function formatDelta(delta: number): string {
  const rounded = Math.round(Math.abs(delta));
  if (rounded === 0) return "Level with opponents";
  return `${delta < 0 ? "−" : "+"}${rounded} pts vs opponents`;
}

/**
 * The pooled numbers, drawn with the read-out's own pieces: the four headline
 * figures as stat tiles, then the court plan and placement grid the analysis
 * feature draws for a single match, over the pooled maps; the shot mix as the
 * same one-line breakdown a PlayerSection shows; and the top patterns through
 * the same `prettyPattern`. A profile must look like the read-outs it was
 * built from, so this file reuses rather than redraws.
 *
 * Cross-feature imports, documented (docs/01 rule 2): CoverageGrid,
 * PlacementGrid and format.ts are the analysis feature's; the profile is a
 * pooled read-out and inherits its visual grammar on purpose.
 */
export function ProfileTendencies({ stats }: ProfileTendenciesProps) {
  const mix = useMemo(() => formatShotTypeBreakdown(shotTypeCounts(stats.shotTypes)), [stats.shotTypes]);

  return (
    <>
      <View style={styles.tiles}>
        <View style={styles.tileRow}>
          <StatTile
            label="T-time"
            value={stats.tTimePct === null ? "—" : `${stats.tTimePct.toFixed(1)}%`}
            hint={
              stats.versus.clips > 0 && stats.versus.tTimeDelta !== null
                ? formatDelta(stats.versus.tTimeDelta)
                : "Frames within 1.5 m of the T"
            }
          />
          <StatTile
            label="Predictability"
            value={stats.predictability === null ? "—" : formatPercent(stats.predictability)}
            hint="Higher = easier to read"
          />
        </View>
        <View style={styles.tileRow}>
          <StatTile
            label="Avg rally"
            value={stats.avgRallyShots === null ? "—" : `${stats.avgRallyShots.toFixed(1)} shots`}
            hint={stats.longestRally > 0 ? `Longest ${stats.longestRally}` : "In their recordings"}
          />
          <StatTile
            label="Shots per clip"
            value={stats.recordings > 0 ? String(Math.round(stats.totalShots / stats.recordings)) : "—"}
            hint={`${stats.totalShots} in all`}
          />
        </View>
      </View>

      <Card style={styles.card}>
        <View style={styles.intro}>
          <Text style={styles.heading}>Where they play, and where they send it</Text>
          <Text style={styles.caption}>
            Pooled over every recording: the court plan and T-time are weighted by how long each
            one ran; placement, shot mix and patterns are totals. Placement is where each shot was
            retrieved — the opponent&apos;s position at the next ball, a proxy for where it landed.
            The pipeline does not track the ball.
          </Text>
        </View>

        {stats.coverage === null ? (
          <Text style={styles.caption}>
            No court map — these clips carry the numbers but no coverage heatmap.
          </Text>
        ) : (
          <CoverageGrid heatmap={stats.coverage} />
        )}
        <View style={styles.divider} />

        <PlacementGrid placement={stats.placement} shots={stats.placementTotal} />
        <Text style={styles.caption}>
          {stats.placementTotal} shots by the quadrant they were retrieved from — a proxy for where
          they landed.
        </Text>
        <View style={styles.divider} />

        <View style={styles.block}>
          <Text style={styles.label}>Shot mix (indicative)</Text>
          {mix.length > 0 ? (
            <Text style={styles.mix}>{mix}</Text>
          ) : (
            <Text style={styles.caption}>No shot classes in these recordings.</Text>
          )}
          <Text style={styles.caption}>
            {stats.classifiedShots} shots carrying a class. Classes are read from body pose with no
            ball tracking and are unaudited; shot detection itself was audited at ~63% precision,
            so every count here includes some phantom shots.
          </Text>
        </View>
        <View style={styles.divider} />

        <View style={styles.block}>
          <Text style={styles.label}>Top patterns</Text>
          <Text style={styles.caption}>
            Where one shot landed, then where the next did — share of all {stats.transitionsTotal}{" "}
            such pairs.
          </Text>
          {stats.topPatterns.length === 0 ? (
            <Text style={styles.caption}>No shot-to-shot sequences yet.</Text>
          ) : (
            stats.topPatterns.map((item, index) => (
              <View key={item.pattern} style={styles.patternRow}>
                <Text style={styles.patternIndex}>{index + 1}</Text>
                <Text style={styles.pattern}>
                  {prettyPattern(`${item.pattern} (${Math.round(item.share * 100)}%)`)}
                </Text>
              </View>
            ))
          )}
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  tiles: { gap: spacing.sm },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  card: { gap: spacing.md },
  intro: { gap: spacing.xs },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textDim },
  divider: { height: 1, backgroundColor: colors.line },
  block: { gap: spacing.xs },
  label: { ...type.label, color: colors.text },
  mix: { ...type.captionStrong, color: colors.accentText },
  patternRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  patternIndex: { ...type.captionStrong, color: colors.textDim, minWidth: 14 },
  pattern: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
});
