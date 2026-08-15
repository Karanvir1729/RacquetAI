/**
 * RacquetAI design tokens — PROVISIONAL palette.
 *
 * The pattern is inherited from the daybot mobile app's ADR-010: every colour
 * is a dark/light `DynamicColorIOS` pair, so iOS resolves the theme natively.
 * Module-scope `StyleSheet.create` keeps working, no hooks are needed, and
 * flipping the system setting restyles the app instantly
 * (`userInterfaceStyle: "automatic"` in app.json). Android has no equivalent
 * of DynamicColorIOS, so it pins the dark palette until an Appearance-listener
 * pass is done (app.json android.userInterfaceStyle matches).
 *
 * The palette itself is a placeholder: deep court green canvas, high-contrast
 * text, optic-yellow accent (the tennis-ball colour). The feat/branding
 * worktree finalises exact hex values — which only works if every colour in
 * the app is read from a token. NEVER hardcode a colour in a component.
 *
 * Rules that matter:
 * - Accent fills always carry `onAccent` (ink) text.
 * - Accent-coloured TEXT on light surfaces must use `accentText` (deep green),
 *   never `accent` — optic yellow reads fine as a fill but is illegible as
 *   light-mode text.
 */
import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

/** Dark value + light value → one adaptive colour (iOS); dark pin (Android). */
function dyn(dark: string, light: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ dark, light }) : dark;
}

export const colors = {
  // canvas & surfaces
  bg: dyn("#081711", "#f2f6f1"),
  panel: dyn("#0c1f17", "#ffffff"),
  card: dyn("rgba(255,255,255,0.03)", "#ffffff"),
  cardRaised: dyn("rgba(255,255,255,0.05)", "rgba(8,23,17,0.04)"),
  chip: dyn("rgba(16,32,24,0.72)", "rgba(255,255,255,0.86)"),

  // hairlines
  line: dyn("rgba(255,255,255,0.09)", "rgba(8,23,17,0.10)"),
  line2: dyn("rgba(255,255,255,0.16)", "rgba(8,23,17,0.18)"),

  // text
  text: dyn("rgba(255,255,255,0.92)", "#0b1a13"),
  textDim: dyn("rgba(255,255,255,0.62)", "rgba(11,26,19,0.62)"),
  textFaint: dyn("rgba(255,255,255,0.45)", "rgba(11,26,19,0.42)"),
  watermark: dyn("rgba(255,255,255,0.06)", "rgba(8,23,17,0.08)"),

  // brand accent (optic yellow — the fill is constant; accent TEXT deepens on light)
  accent: dyn("#d7f651", "#d7f651"),
  accentText: dyn("#e2f97a", "#3f7d20"),
  accentSoft: dyn("rgba(215,246,81,0.12)", "rgba(63,125,32,0.12)"),
  onAccent: dyn("#081711", "#0b140a"),
  glow: dyn("rgba(215,246,81,0.35)", "rgba(63,125,32,0.25)"),

  // recording indicator + status
  danger: dyn("#ff7a7a", "#d3392f"),
  dangerSoft: dyn("rgba(255,122,122,0.12)", "rgba(211,57,47,0.10)"),

  // literal white surfaces that must NOT flip with the theme (switch thumbs)
  surfaceWhite: "#ffffff" as ColorValue,
  inkOnWhite: "#081711" as ColorValue,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Provisional type scale — weights 400 / 600 / 800 until branding lands. */
export const type = {
  display: { fontSize: 34, fontWeight: "800" as const, letterSpacing: -1.2, lineHeight: 36 },
  title: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.8 },
  heading: { fontSize: 19, fontWeight: "600" as const, letterSpacing: -0.3 },
  body: { fontSize: 16, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, fontWeight: "600" as const },
  label: { fontSize: 14, fontWeight: "600" as const },
  caption: { fontSize: 12.5, fontWeight: "400" as const },
  captionStrong: { fontSize: 12.5, fontWeight: "600" as const },
} as const;

/** Apple HIG minimum tap target. */
export const MIN_TOUCH_TARGET = 44;

/** Card depth, translated to RN shadow props. */
export const cardShadow = {
  shadowColor: "#000",
  shadowOpacity: 0.35,
  shadowRadius: 25,
  shadowOffset: { width: 0, height: 18 },
  elevation: 12,
} as const;

/**
 * Accent halo (offset-0 glow). iOS `shadow*` props don't render on Android and
 * `elevation` cannot produce a centered glow, so Android uses the RN 0.76+
 * `boxShadow` string — iOS keeps its original shadow rendering untouched.
 * The rgb is the optic-yellow accent (#d7f651); a boxShadow string can't read
 * a token, so feat/branding must update this literal with the palette.
 */
export function accentGlow(opacity: number, radiusPx: number, offsetY = 0) {
  return Platform.OS === "android"
    ? { boxShadow: `0 ${offsetY}px ${radiusPx}px rgba(215,246,81,${opacity})` }
    : {
        shadowColor: colors.accent,
        shadowOpacity: opacity,
        shadowRadius: radiusPx,
        shadowOffset: { width: 0, height: offsetY },
      };
}
