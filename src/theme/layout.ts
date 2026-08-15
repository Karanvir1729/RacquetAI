/**
 * Responsive layout tokens.
 *
 * The app is phone-first but ships for iPad from day one (`ios.supportsTablet`
 * — ADR-002), so every screen has to survive a canvas from ~320pt (Split View)
 * up to ~1180pt (11-inch iPad in landscape). Stretching a phone layout
 * edge-to-edge across 1180pt is exactly what earned the predecessor app an
 * App Review guideline-4 rejection ("crowded, laid out, or displayed in a way
 * that made it difficult to use").
 *
 * The fix is the standard iPad treatment: content lives in a centred column of
 * readable width and the dark canvas breathes either side. On any phone the
 * window is narrower than these caps, so every one of them is a no-op — the
 * iPhone layout is untouched.
 *
 * Two widths only, so switching tabs never shifts the column:
 */

/** App tabs and lists. ~75-90 characters per line at body size. */
export const CONTENT_MAX_WIDTH = 760;

/** Narrow centred forms/dialog-like screens. */
export const FORM_MAX_WIDTH = 560;

/** A centred column: full width on phones, capped and centred on iPad. */
export const column = (maxWidth: number = CONTENT_MAX_WIDTH) =>
  ({ width: "100%", maxWidth, alignSelf: "center" }) as const;
