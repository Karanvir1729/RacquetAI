import { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing, type } from "@/theme/tokens";

interface ScreenHeaderProps extends PropsWithChildren {
  title: string;
  /** Optional one-line context under the title (match date, court name). */
  subtitle?: string;
  /** Optional trailing element (e.g. a segmented control) pinned below the title. */
  accessory?: ReactNode;
  /**
   * Absorb the top safe-area inset here so the host doesn't also pad it.
   * Screens that already applied `paddingTop: insets.top` on their root pass
   * `padTop={false}` (the default).
   */
  padTop?: boolean;
}

/**
 * The one screen header: pinned title + optional subtitle over a bottom
 * hairline, sitting on the canvas so the body scrolls beneath it. Every
 * top-level tab uses this so headers read as one app.
 */
export function ScreenHeader({
  title,
  subtitle,
  accessory,
  padTop = false,
  children,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, padTop ? { paddingTop: insets.top + spacing.md } : null]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {accessory}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.bg,
  },
  title: { ...type.display, color: colors.text },
  subtitle: { ...type.caption, color: colors.textDim },
});
