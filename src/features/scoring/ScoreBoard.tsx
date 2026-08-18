/**
 * The glanceable half of the Score keeper: two names, two huge numerals, who
 * is serving and from which box, games won, and the game/match-ball warning.
 *
 * Read from a metre away by someone who is out of breath, so: the point
 * numerals are the largest type in the app by a wide margin, the serving side
 * is marked with a filled accent chip rather than a subtle tint, and nothing
 * here moves position between rallies — A is always left, B is always right,
 * because a board that swaps sides with the serve is unreadable at a glance.
 */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, MIN_TOUCH_TARGET, radius, spacing, type } from "@/theme/tokens";

import { gameBallSide, PlayerNames } from "./announce";
import { OTHER_SIDE, ServeBox, Side, SIDES, SquashScore } from "./types";

interface ScoreBoardProps {
  score: SquashScore;
  names: PlayerNames;
  /** Called when the incoming server picks a box; only offered when legal. */
  onChooseBox: (box: ServeBox) => void;
}

export function ScoreBoard({ score, names, onChooseBox }: ScoreBoardProps) {
  const ball = gameBallSide(score);
  const banner = ballBanner(score, names, ball);
  // The screen does not scroll, so on a 667pt phone the full-size numeral
  // would push the rally buttons off the bottom. One step down is enough:
  // still the biggest thing on the screen by a factor of three.
  const compact = useWindowDimensions().height < 750;

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {SIDES.map((side) => (
          <SideColumn key={side} side={side} score={score} names={names} compact={compact} />
        ))}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.games} numberOfLines={1}>
          Games {score.games.A} – {score.games.B}
        </Text>
        {score.gameHistory.length > 0 ? (
          <Text style={styles.history} numberOfLines={1}>
            {score.gameHistory.map((game) => `${game.A}-${game.B}`).join("  ·  ")}
          </Text>
        ) : null}
      </View>

      {score.winner === null ? (
        <ServeRow score={score} names={names} onChooseBox={onChooseBox} />
      ) : null}

      {banner === null ? null : (
        <View style={styles.banner}>
          <Text style={styles.bannerText} numberOfLines={1}>
            {banner}
          </Text>
        </View>
      )}
    </View>
  );
}

/** "Game ball" / "Match ball, Sam" / the final result — or nothing. */
function ballBanner(score: SquashScore, names: PlayerNames, ball: Side | null): string | null {
  if (score.winner !== null) {
    const w = score.winner;
    return `${names[w]} wins ${score.games[w]}–${score.games[OTHER_SIDE[w]]}`;
  }
  if (ball === null) return null;
  const call = score.games[ball] + 1 >= score.config.gamesToWin ? "Match ball" : "Game ball";
  return `${call} · ${names[ball]}`;
}

function SideColumn({
  side,
  score,
  names,
  compact,
}: {
  side: Side;
  score: SquashScore;
  names: PlayerNames;
  compact: boolean;
}) {
  const serving = score.winner === null && score.server === side;
  return (
    <View
      style={styles.column}
      accessibilityRole="text"
      accessibilityLabel={`${names[side]}, ${score.points[side]} points${serving ? ", serving" : ""}`}
    >
      <Text style={[styles.name, serving && styles.nameServing]} numberOfLines={1}>
        {names[side]}
      </Text>
      <Text
        style={[styles.points, compact && styles.pointsCompact, serving && styles.pointsServing]}
        numberOfLines={1}
        // Dynamic Type is respected everywhere else in the app, but this
        // numeral starts at 84pt: at a 3x accessibility multiplier it would
        // shove the rally buttons off a screen that cannot scroll.
        maxFontSizeMultiplier={1.2}
      >
        {score.points[side]}
      </Text>
    </View>
  );
}

/**
 * Who serves next and from where. While the box choice is open (game start or
 * a fresh handout) the chip is a button that flips it; the rest of the time it
 * is a read-out, because the box alternates on its own and offering a control
 * that silently does nothing is worse than offering none.
 */
function ServeRow({ score, names, onChooseBox }: ScoreBoardProps) {
  const box = score.serveBox;
  const label = `${names[score.server]} serves · ${box === "left" ? "Left" : "Right"} box`;

  if (!score.serverMayChooseBox) {
    return (
      <View style={styles.serveChip}>
        <Ionicons name="tennisball" size={14} color={colors.onAccent} />
        <Text style={styles.serveText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to switch to the ${box === "left" ? "right" : "left"} box`}
      onPress={() => {
        selectionHaptic();
        onChooseBox(box === "left" ? "right" : "left");
      }}
      style={({ pressed }) => [styles.serveChip, pressed && styles.pressed]}
    >
      <Ionicons name="tennisball" size={14} color={colors.onAccent} />
      <Text style={styles.serveText} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="swap-horizontal" size={14} color={colors.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: spacing.sm },
  row: { flexDirection: "row", alignSelf: "stretch" },
  column: { flex: 1, alignItems: "center", gap: spacing.xs },
  name: { ...type.label, color: colors.textDim },
  nameServing: { color: colors.accentText, fontWeight: "800" },
  // The one place in the app that outgrows the type scale: this numeral has to
  // be legible across a squash court, not just at arm's length.
  points: {
    fontSize: 84,
    lineHeight: 92,
    fontWeight: "800",
    letterSpacing: -3,
    color: colors.textDim,
    fontVariant: ["tabular-nums"],
  },
  pointsCompact: { fontSize: 62, lineHeight: 68, letterSpacing: -2 },
  pointsServing: { color: colors.text },
  metaRow: { alignItems: "center", gap: 2 },
  games: { ...type.bodyStrong, color: colors.text },
  history: { ...type.caption, color: colors.textFaint },
  serveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  serveText: { ...type.captionStrong, color: colors.onAccent },
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  bannerText: { ...type.captionStrong, color: colors.accentText },
  pressed: { opacity: 0.7 },
});
