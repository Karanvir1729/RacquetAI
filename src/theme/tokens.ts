/**
 * RacquetIQ design tokens — final palette. See docs/04-branding.md.
 *
 * The pattern is inherited from a prior App-Store-shipped app (see docs/02): every colour
 * is a dark/light `DynamicColorIOS` pair, so iOS resolves the theme natively.
 * Module-scope `StyleSheet.create` keeps working, no hooks are needed, and
 * flipping the system setting restyles the app instantly
 * (`userInterfaceStyle: "automatic"` in app.json). Android has no equivalent
 * of DynamicColorIOS, so it pins the dark palette until an Appearance-listener
 * pass is done (app.json android.userInterfaceStyle matches).
 *
 * The palette is Court Ink (#06130E) canvas, Chalk text, and one electric
 * accent — Optic (#D8FA3C), the tennis-ball colour. These hex values are the
 * same ones the brand SVGs in assets/brand/src/ are drawn with; changing a
 * colour here means regenerating the assets. NEVER hardcode a colour in a
 * component — every colour in the app is read from this file.
 *
 * Rules that matter:
 * - Accent fills always carry `onAccent` (ink) text.
 * - Optic is a FILL, never ink. `accent` measures 1.1:1 on the light canvas, so
 *   anything that is ink — text, an icon glyph, a border, a stroke, a spinner —
 *   reads `accentText`, and a data mark (heat cell, meter fill, the T) reads
 *   `data`. Both deepen to Court Green on light; `accent` does not flip.
 * - The ink ramp is three tiers and stays three tiers. `text` is primary,
 *   `textDim` is secondary and readable, `textFaint` is the disabled/pending
 *   tier — placeholders, an unreached step's number, a dimmed pip, a watermark.
 *   `textFaint` is 2.7:1 on light, which is legal ONLY because WCAG exempts
 *   genuinely inactive components. Never set body copy, a value the user has to
 *   read, or the label of an *enabled* control in `textFaint`; that is what
 *   `textDim` is for.
 */
import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

/** Dark value + light value → one adaptive colour (iOS); dark pin (Android). */
function dyn(dark: string, light: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ dark, light }) : dark;
}

export const colors = {
  // canvas & surfaces — Court Ink / Chalk Wash
  bg: dyn("#06130E", "#F4F7F3"),
  panel: dyn("#0B2119", "#FFFFFF"),
  card: dyn("rgba(255,255,255,0.03)", "#FFFFFF"),
  cardRaised: dyn("rgba(255,255,255,0.05)", "rgba(6,19,14,0.04)"),
  chip: dyn("rgba(12,42,30,0.72)", "rgba(255,255,255,0.86)"),

  // hairlines
  line: dyn("rgba(255,255,255,0.09)", "rgba(6,19,14,0.10)"),
  line2: dyn("rgba(255,255,255,0.16)", "rgba(6,19,14,0.18)"),

  // text
  text: dyn("rgba(255,255,255,0.92)", "#08160F"),
  textDim: dyn("rgba(255,255,255,0.62)", "rgba(8,22,15,0.62)"),
  textFaint: dyn("rgba(255,255,255,0.45)", "rgba(8,22,15,0.42)"),
  watermark: dyn("rgba(255,255,255,0.06)", "rgba(6,19,14,0.08)"),

  // brand accent (Optic — the fill is constant; accent TEXT deepens on light)
  accent: dyn("#D8FA3C", "#D8FA3C"),
  accentText: dyn("#EBFF8C", "#1F6B4A"),
  accentSoft: dyn("rgba(216,250,60,0.12)", "rgba(31,107,74,0.12)"),
  // Data ink — heat cells, meter fills, the T marker. A thin or low-opacity
  // mark cannot use `accent`: Optic at 12% on a white canvas is nothing at all.
  // This is the accent's *data* form, and like `accentText` it deepens to Court
  // Green on light. Same rule, different surface.
  data: dyn("#D8FA3C", "#1F6B4A"),
  onAccent: dyn("#06130E", "#06130E"),
  glow: dyn("rgba(216,250,60,0.35)", "rgba(31,107,74,0.22)"),

  // recording indicator + status
  danger: dyn("#FF6B6B", "#C62F26"),
  dangerSoft: dyn("rgba(255,107,107,0.12)", "rgba(198,47,38,0.10)"),

  // backdrop behind transparent modals (settings editors); ink-tinted on light
  scrim: dyn("rgba(0,0,0,0.60)", "rgba(6,19,14,0.45)"),

  // literal white surfaces that must NOT flip with the theme (switch thumbs)
  surfaceWhite: "#FFFFFF" as ColorValue,
  inkOnWhite: "#06130E" as ColorValue,

  // Overlay ink — the pose skeleton drawn ON THE VIDEO, not on the page. These
  // three are identical in both themes on purpose: a squash court is a bright
  // wall and a pale floor whichever theme the user picked, so the figures have
  // to hold up against the footage, not against the app canvas. Wire player B
  // to `text` and the skeleton looks right on dark and turns near-black over a
  // dark-shirted player on light — the same figure, invisible, because a page
  // token was used to paint something that is not on the page. Chalk on Optic
  // with an ink casing works over both. Do NOT make these a dyn() pair.
  overlayA: "#D8FA3C" as ColorValue,
  overlayB: "#FFFFFF" as ColorValue,
  overlayCasing: "#06130E" as ColorValue,
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

/** Type scale — the platform UI face (SF on iOS, Roboto on Android) at weights
 *  400 / 600 / 800. RacquetIQ ships no custom font; see docs/04-branding.md. */
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
 * The rgb below is Optic #D8FA3C spelled out in decimal: a boxShadow string
 * cannot read a `DynamicColorIOS` token, so this literal is the one place the
 * accent is duplicated. Change it whenever `colors.accent` changes.
 */
export function accentGlow(opacity: number, radiusPx: number, offsetY = 0) {
  return Platform.OS === "android"
    ? { boxShadow: `0 ${offsetY}px ${radiusPx}px rgba(216,250,60,${opacity})` }
    : {
        shadowColor: colors.accent,
        shadowOpacity: opacity,
        shadowRadius: radiusPx,
        shadowOffset: { width: 0, height: offsetY },
      };
}
