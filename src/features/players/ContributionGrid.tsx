import { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing, type } from "@/theme/tokens";

import { calendarWeeks, type CalendarDay } from "./aggregate";
import { formatIsoDay } from "./display";
import type { PlayerClip } from "./shape";

/**
 * The recordings calendar — a year of days, one square each, the way a commit
 * graph shows a year of work: a profile should show at a glance how often
 * this player has been filmed and when, before anyone reads a number.
 *
 * Columns are weeks (oldest on the left), rows Monday to Sunday; the maths is
 * all in `calendarWeeks`, this file only paints. Level 0 is the hairline
 * colour so an empty day still draws the grid; levels 1–4 are the data ink at
 * rising opacity, relative to the busiest day (a sparse profile still lights
 * up). Days after today are left blank rather than drawn as "nothing
 * happened". Cells are data marks, so they read `colors.data` — never the
 * raw accent (tokens.ts: Optic is a fill, and a 35%-opacity mark in it is
 * nothing at all on the light canvas).
 *
 * Every in-range day is a button: tap it and the screen lists that day's
 * recordings under the grid (a coach wants to know WHICH match a dark square
 * was), tap it again and the list closes. The selected square wears a ring in
 * `accentText` — ink, the app's selection colour — drawn as an overlay inside
 * the 10pt footprint so nothing in the grid shifts. Its fill pulls in behind
 * the ring, because on the light canvas `accentText` and `data` are the same
 * green and a ring alone on a full square would vanish. A 10pt square is far
 * under the 44pt target, so each cell takes slop out to the middle of the
 * gap — and no further: overlapping hit rects are not settled by distance,
 * the later sibling wins (the next row, the next week), so a wider slop
 * would hand most taps to a neighbour. 12pt is honest; the grid is a year.
 *
 * 52 columns of 10pt squares with 2pt gaps is ~620pt wide, so the grid
 * scrolls inside its own box rather than widening the screen, and opens
 * scrolled to the right-hand end because the recent weeks are the ones a
 * coach is looking for.
 */

const CELL = 10;
const GAP = 2;
const CELL_HIT_SLOP = GAP / 2;
const RING_INSET = 3;
const MONTH_ROW = 14;
const WEEKDAY_LABELS: Record<number, string> = { 0: "Mon", 2: "Wed", 4: "Fri" };
const LEVEL_OPACITY: Record<CalendarDay["level"], number> = {
  0: 1,
  1: 0.35,
  2: 0.55,
  3: 0.8,
  4: 1,
};

function cellLabel(day: CalendarDay): string {
  const when = formatIsoDay(day.date);
  if (day.count === 0) return `${when}, no recordings`;
  const recordings = `${day.count} ${day.count === 1 ? "recording" : "recordings"}`;
  const minutes = `${Math.max(1, Math.round(day.minutes))} min`;
  return `${when}, ${recordings}, ${minutes}`;
}

interface CellProps {
  day: CalendarDay;
  selected: boolean;
  onPress: (date: string) => void;
}

function Cell({ day, selected, onPress }: CellProps) {
  if (!day.inRange) return <View style={styles.cellBlank} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cellLabel(day)}
      accessibilityState={{ selected }}
      hitSlop={CELL_HIT_SLOP}
      onPress={() => onPress(day.date)}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.fill,
          day.level === 0 ? styles.fillEmpty : styles.fillLit,
          day.level === 0 ? null : { opacity: LEVEL_OPACITY[day.level] },
          selected && styles.fillSelected,
        ]}
      />
      {selected ? <View pointerEvents="none" style={styles.ring} /> : null}
    </Pressable>
  );
}

interface ContributionGridProps {
  clips: readonly PlayerClip[];
  /** Injectable for tests; defaults to now. */
  today?: Date;
  /** The day whose recordings are open under the grid, YYYY-MM-DD; null for none. */
  selectedDay?: string | null;
  /** Tapping a day toggles it: the same day again sends null. */
  onSelectDay?: (date: string | null) => void;
}

export function ContributionGrid({
  clips,
  today,
  selectedDay = null,
  onSelectDay,
}: ContributionGridProps) {
  const calendar = useMemo(() => calendarWeeks(clips, today ?? new Date()), [clips, today]);
  const scroller = useRef<ScrollView | null>(null);

  // Open on the recent end. scrollToEnd clamps, so no measuring.
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: false });
  }, [calendar]);

  const columns = calendar.weeks.length;
  const gridWidth = columns * CELL + Math.max(0, columns - 1) * GAP;
  const summary = `${calendar.inWindow} ${calendar.inWindow === 1 ? "recording" : "recordings"} in the last 12 months`;

  const toggle = (date: string) => onSelectDay?.(date === selectedDay ? null : date);

  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Recordings calendar</Text>
        <Text style={styles.summary}>{summary}</Text>
      </View>

      <View style={styles.body}>
        {/* Weekday gutter, outside the scroller so it stays put. */}
        <View style={styles.gutter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: 7 }, (_, row) => (
            <Text key={row} style={styles.gutterLabel}>
              {WEEKDAY_LABELS[row] ?? ""}
            </Text>
          ))}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={{ width: gridWidth }}>
            {/* Month labels ride the same column track as the cells, so each
                sits exactly over the week its month began in. */}
            <View style={styles.monthRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {calendar.months.map((month) => (
                <Text
                  key={`${month.col}-${month.label}`}
                  style={[styles.monthLabel, { left: month.col * (CELL + GAP) }]}
                >
                  {month.label}
                </Text>
              ))}
            </View>
            <View style={styles.weeks}>
              {calendar.weeks.map((week, index) => (
                <View key={week[0]?.date ?? index} style={styles.week}>
                  {week.map((day) => (
                    <Cell
                      key={day.date}
                      day={day}
                      selected={day.date === selectedDay}
                      onPress={toggle}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.legendLabel}>Less</Text>
        <View style={styles.cellEmpty} />
        {([1, 2, 3, 4] as const).map((level) => (
          <View key={level} style={[styles.cellLit, { opacity: LEVEL_OPACITY[level] }]} />
        ))}
        <Text style={styles.legendLabel}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  heading: { ...type.label, color: colors.text },
  summary: { ...type.caption, color: colors.textDim },
  body: { flexDirection: "row", gap: spacing.xs },
  gutter: { paddingTop: MONTH_ROW, gap: GAP, width: 26 },
  gutterLabel: {
    height: CELL,
    lineHeight: CELL,
    fontSize: 9,
    fontWeight: "600",
    color: colors.textDim,
    textAlign: "right",
  },
  scrollContent: { paddingRight: spacing.xs },
  monthRow: { height: MONTH_ROW },
  monthLabel: {
    position: "absolute",
    top: 0,
    fontSize: 9,
    fontWeight: "600",
    lineHeight: MONTH_ROW - 2,
    color: colors.textDim,
  },
  weeks: { flexDirection: "row", gap: GAP },
  week: { gap: GAP },
  cellBlank: { width: CELL, height: CELL },
  // A day is a 10pt button; its fill and its selection ring are overlays inside
  // it, so selecting never moves a neighbour.
  cell: { width: CELL, height: CELL },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 2 },
  fillEmpty: { backgroundColor: colors.line },
  fillLit: { backgroundColor: colors.data },
  fillSelected: { top: RING_INSET, left: RING_INSET, right: RING_INSET, bottom: RING_INSET, borderRadius: 1 },
  ring: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: colors.accentText,
  },
  pressed: { opacity: 0.7 },
  cellEmpty: { width: CELL, height: CELL, borderRadius: 2, backgroundColor: colors.line },
  cellLit: { width: CELL, height: CELL, borderRadius: 2, backgroundColor: colors.data },
  legend: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: GAP + 1 },
  legendLabel: { fontSize: 10, color: colors.textDim, marginHorizontal: spacing.xs },
});
