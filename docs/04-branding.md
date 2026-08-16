# 04 — Branding

The RacquetAI identity: palette, mark, type, and the asset pipeline that turns
four SVGs into every PNG the app ships.

Owned by **feat/branding**. `src/theme/tokens.ts` is the machine-readable copy
of the palette below and the two are expected to agree hex for hex.

---

## 1. The idea

**A lit squash court at night.**

Squash is the beachhead: a glass-backed court, a fixed camera on the balcony, a
club box league. That room is the brand — near-black green in the corners,
chalk-white lines, and one violently bright ball moving through it. The app is
premium and sporty, not playful; it sits closer to a training tool than to a
consumer game.

Three rules fall out of that and everything else is detail:

1. **One accent, and it earns its place.** Optic yellow is the ball. It marks
   the live thing — the record button, the current score, the AI's output. If
   everything is Optic, nothing is.
2. **Dark is the default, not a mode.** Match footage, court video and the
   camera viewfinder all live better on ink. Light theme exists and is fully
   specified, but the brand's face is dark.
3. **The mark is geometry, not illustration.** No mascots, no gradients inside
   the logo, no perspective. It has to survive being 20px tall and one colour.

---

## 2. Palette

### Brand colours

| Name | Hex | What it is |
| --- | --- | --- |
| **Court Ink** | `#06130E` | The canvas. Near-black with green in it, never neutral grey. Also the ink used *on* Optic. |
| **Court** | `#0B2119` | The panel one step up from the canvas. |
| **Court Raised** | `#0C2A1E` | The lit top edge of the court — the top stop of the app-icon gradient, and the dark chip fill. |
| **Optic** | `#D8FA3C` | The ball under floodlight. The one accent. |
| **Optic Bright** | `#EBFF8C` | Optic pulled up for *text* on dark, where full Optic vibrates. |
| **Court Green** | `#1F6B4A` | Optic's stand-in for accent text on light surfaces, where Optic is illegible. |
| **Chalk** | `#FFFFFF` | Court lines, the logo's frame, primary text on dark. |
| **Chalk Wash** | `#F4F7F3` | The light-theme canvas. White with a breath of court green. |
| **Fault** | `#FF6B6B` dark / `#C62F26` light | Recording indicator and destructive actions. The only other colour allowed to be saturated. |

### Token mapping

Every token in `src/theme/tokens.ts` is a `dark, light` pair resolved natively
by `DynamicColorIOS`. Android pins the dark column (see the note in that file).

| Token | Dark | Light |
| --- | --- | --- |
| `bg` | `#06130E` | `#F4F7F3` |
| `panel` | `#0B2119` | `#FFFFFF` |
| `card` | `rgba(255,255,255,0.03)` | `#FFFFFF` |
| `cardRaised` | `rgba(255,255,255,0.05)` | `rgba(6,19,14,0.04)` |
| `chip` | `rgba(12,42,30,0.72)` | `rgba(255,255,255,0.86)` |
| `line` | `rgba(255,255,255,0.09)` | `rgba(6,19,14,0.10)` |
| `line2` | `rgba(255,255,255,0.16)` | `rgba(6,19,14,0.18)` |
| `text` | `rgba(255,255,255,0.92)` | `#08160F` |
| `textDim` | `rgba(255,255,255,0.62)` | `rgba(8,22,15,0.62)` |
| `textFaint` | `rgba(255,255,255,0.45)` | `rgba(8,22,15,0.42)` |
| `watermark` | `rgba(255,255,255,0.06)` | `rgba(6,19,14,0.08)` |
| `accent` | `#D8FA3C` | `#D8FA3C` |
| `accentText` | `#EBFF8C` | `#1F6B4A` |
| `accentSoft` | `rgba(216,250,60,0.12)` | `rgba(31,107,74,0.12)` |
| `onAccent` | `#06130E` | `#06130E` |
| `glow` | `rgba(216,250,60,0.35)` | `rgba(31,107,74,0.22)` |
| `danger` | `#FF6B6B` | `#C62F26` |
| `dangerSoft` | `rgba(255,107,107,0.12)` | `rgba(198,47,38,0.10)` |
| `surfaceWhite` | `#FFFFFF` (both) | |
| `inkOnWhite` | `#06130E` (both) | |

`accent` is the one token that does **not** flip: the ball under floodlight is
the same colour in both themes, and Optic holds up as a *fill* on either canvas.
It is only as text that it breaks, which is what `accentText` exists for.

### Contrast

Measured WCAG 2.1 ratios for the pairings that actually occur:

| Foreground | Background | Ratio | |
| --- | --- | --- | --- |
| Chalk | Court Ink | 19.0:1 | ✅ AAA |
| `text` dark | `bg` dark | 16.0:1 | ✅ AAA |
| `text` light | `bg` light | 17.2:1 | ✅ AAA |
| Optic | Court Ink | 16.0:1 | ✅ AAA |
| Optic | Court (`panel` dark) | 14.2:1 | ✅ AAA |
| Court Ink | Optic (`onAccent` on `accent`) | 16.0:1 | ✅ AAA |
| Optic Bright | Court Ink | 17.4:1 | ✅ AAA |
| Court Green | Chalk Wash | 6.0:1 | ✅ AA |
| `textDim` dark | `bg` dark | 7.6:1 | ✅ AAA |
| `textDim` light | `bg` light | 5.0:1 | ✅ AA |
| Fault dark | Court Ink | 6.8:1 | ✅ AA |
| Fault light | Chalk Wash | 5.1:1 | ✅ AA |
| `textFaint` dark | `bg` dark | 4.5:1 | ⚠️ AA, exactly at the line |
| `textFaint` light | `bg` light | **2.7:1** | ⚠️ below AA — disabled tier only |
| **Optic** | **Chalk Wash** | **1.1:1** | ❌ never |

That last row is the whole reason `accentText` exists. Optic on a light
surface is invisible; reach for Court Green instead.

`textFaint` is the **disabled/pending tier** — "Coming soon" rows, inactive tab
labels, placeholder metadata — and it sits below AA on light on purpose, because
it marks unavailable controls, which WCAG exempts. Never set body copy, a value
the user has to read, or the label of an *enabled* control in `textFaint`; that
is what `textDim` is for.

---

## 3. The mark — "Ace Spark"

A geometric **squash** racquet seen head-on and tilted, with a four-point AI
spark sitting at the sweet spot where the strings cross. The racquet says which
sport; the spark says the software is watching. Optic appears exactly twice —
the grip and the spark — so the eye travels the diagonal between them.

### Why the head is a teardrop

Squash clubs are the beachhead, so the silhouette has to name the sport before
anyone reads the app's name. A wide round head reads as tennis no matter what
is written under it, and that is what the mark used to be. Three changes fix
it, and none of them is a detail:

1. **A teardrop head**, widest about a third of the way down from the apex and
   tapering into a narrow throat — not a symmetric oval.
2. **A smaller head relative to the racquet**: 45% of the total length, where
   the tennis head was 60%. This is the proportion the eye actually reads.
3. **A long thin shaft** between throat and grip. This is the strongest cue at
   small sizes, because it survives long after the string bed has mushed.

The stringing area shrank with the head, which is also true of the real thing.

### Construction

Drawn on a **512 × 512** grid. Ink box is **270 × 400** (78% of the grid tall),
centred on (256, 256) to the pixel.

| Element | Geometry |
| --- | --- |
| Head | teardrop path: apex (0,−244), widest ±100 at y −150, narrowing to ±38 at y 20 and closing across a rounded bottom, stroke 36, Chalk |
| String bed | 3 columns × 4 rows, stroke 8 at 24% Chalk, clipped to the head's inner outline |
| Throat | two struts leaving the head flanks at (±44, 6) and converging on (±5, 134), stroke 24, round caps, Chalk |
| Shaft | 32 × 136 pill, radius 16, Chalk |
| Grip | 48 × 188 pill, radius 24, **Optic** |
| Spark | 4-point star, r 76, on the sweet spot (0,−130), **Optic**, counter-rotated +30° so it stays upright |
| Whole mark | rotated **−30°**, uniform scale 0.637 |

The outer translate in the SVG is `243.3 211.2`, not `256 256`. That is
deliberate: the racquet is a diagonal shape, so its tight ink box is not
centred on its own rotation origin. The offset makes the ink box land dead
centre, which is what lets every downstream asset scale the file about its
centre and trust the result. Both the scale and the translate are *measured* —
render the geometry at scale 1, trim, and solve for the pair that puts a
400-tall ink box on centre — so changing the geometry means re-deriving them,
not nudging them.

The **fourth string row** is new with the teardrop. Three rows left the lower
third of the head visibly empty, because a teardrop keeps stringing down into
the taper where an ellipse has already closed.

The **sweet spot sits at y −130**, above the head's mid-point. That is where a
teardrop's stringing area is widest, where a squash player's contact point
actually is, and the only place the spark clears the frame at r 76.

The spark is counter-rotated so that it reads as a *spark* (upright, symmetric)
rather than as a tilted diamond. This is the one place the mark breaks its own
rotation, and it is intentional.

### Clear space

**Clear space = a quarter of the mark's box**, on all four sides — 72 units at
lockup scale, where the mark is nested at 288. Nothing enters it: no type, no
canvas edge, no photo, no UI chrome. It is also the gap between the mark and
the wordmark, which is why the lockup feels like one object rather than two.

(This rule used to be stated as "the height of the spark", which was true of
the tennis mark by coincidence. The squash mark is leaner, so its spark is
smaller relative to the box; the quarter-of-the-box derivation is exact and
survives geometry changes, so it is the one to keep.)

### Minimum sizes

| Use | Minimum |
| --- | --- |
| Full-colour mark | 32 px — the string bed only resolves above ~48 px, so below that the mark is carried by the silhouette alone |
| Monochrome mark | 24 px — the leaner squash shaft goes sub-pixel below this, where the tennis mark held to 20 px |
| Horizontal lockup | 160 px wide — below this drop the wordmark and use the mark alone |

### On light surfaces

The mark's frame is Chalk, so it **disappears on a light background**. Use
`mark-mono.svg` recoloured to Court Ink, or place the full-colour mark on a
Court Ink tile. Never outline the Chalk mark to rescue it.

---

## 4. Typography

**The platform UI face, always.** SF Pro on Apple platforms, Roboto on Android,
resolved through React Native's default stack — no bundled font files, no
`expo-font` loading step, nothing to block first paint. It is also the face
users read every other app in, which is what makes a sports utility feel
native rather than branded-at.

The scale lives in `type` in `src/theme/tokens.ts` and is not restated here.
Its shape: display/title are weight 800 with tight negative tracking (−1.2 /
−0.8) so headings feel athletic; body is 400; anything that labels a control is
600. Scores and timers should use the display and title steps — the tabular
feel comes from the weight and tracking, not from a different family.

**The wordmark** is the same face at weight 700, tracked −6 at 168 units
(≈ −0.036 em), which sets "RacquetAI" as one word. "Racquet" is Chalk, "AI" is
Optic. The colour break is the *only* separation: no space, no second capital
in the middle, no camel-case gap.

---

## 5. Assets

All generated from `assets/brand/src/` into `assets/brand/`.

### Masters

| File | What it is |
| --- | --- |
| `mark.svg` | **Canonical geometry.** The full-colour mark, transparent. |
| `mark-mono.svg` | One flat colour, no string bed. Android monochrome, notification silhouette, embroidery, 1-bit print. |
| `icon.svg` | App-icon composition: Court Ink field lit from the top, one Optic bloom behind the sweet spot, mark at 72% ink. |
| `splash.svg` | Splash composition: mark at 64% ink with a soft Optic halo that fades to alpha 0 inside the canvas. |
| `wordmark.svg` | Horizontal lockup, mark + "RacquetAI". |

An SVG cannot reference a shape in another file (librsvg will not resolve
cross-document references), so four of these embed a **copy** of the mark's
drawing elements between `@mark-geometry` markers. Drift between the copies is
the one failure mode that would not show up in any single render, so the
generator compares them and fails on divergence. Edit `mark.svg` first, mirror
the change, and let the script confirm it.

### Deliverables

| File | Size | Format | Where it goes |
| --- | --- | --- | --- |
| `app-icon.png` | 1024² | RGB, **no alpha** | `expo.icon` — iOS home screen and the store listing |
| `android-foreground.png` | 1024² | RGBA | `android.adaptiveIcon.foregroundImage` |
| `android-monochrome.png` | 1024² | RGBA | `android.adaptiveIcon.monochromeImage` — themed icons |
| `splash.png` | 1024² | RGBA | `expo-splash-screen`, drawn at `imageWidth: 180` |
| `notification-icon.png` | 96² | RGBA, white-only | `expo.notification.icon` |
| `favicon.png` | 48² | RGB | `web.favicon` |

Three constraints are non-obvious and all three are asserted by the generator:

- **The iOS icon must not carry an alpha channel.** App Store Connect rejects
  it at upload, which is *after* a full build. The check parses the PNG's IHDR
  colour type rather than trusting `flatten()` to have run.
- **The Android foreground must stay inside the adaptive safe zone.** The
  launcher masks the outer sixth on every side and can scale the foreground up
  inside its mask, so the ink is inset to 561 px of 1024 rather than filling it.
- **The notification icon must be white on transparent.** Android throws away
  the colour and keeps the silhouette; anything else silently becomes a white
  blob.

### app.json wiring

```jsonc
"backgroundColor": "#06130E",             // Court Ink behind everything
"icon": "./assets/brand/app-icon.png",
"notification": { "icon": "…/notification-icon.png", "color": "#D8FA3C" },
"android": { "adaptiveIcon": { "backgroundColor": "#06130E", … } },
"plugins": [["expo-splash-screen", { "backgroundColor": "#06130E",
                                     "image": "./assets/brand/splash.png",
                                     "imageWidth": 180 }]]
```

The splash PNG is transparent and `expo-splash-screen` paints Court Ink behind
it, so one image covers every device size and can never show a seam. At
`imageWidth: 180` the mark lands ~115 pt tall.

`expo.notification` is the legacy config key; it is what works without adding
`expo-notifications`. When push lands, move `icon`/`color` into that library's
config plugin and delete the block.

---

## 6. Do / don't

**Do**

- Put Optic on the live thing: record, current score, the AI's output.
- Keep the mark on Court Ink or on a Court Ink tile.
- Use `accentText` for any accent-coloured text.
- Regenerate assets from the SVGs and commit both.

**Don't**

- Don't put Optic text on a light surface (1.1:1).
- Don't recolour the mark's frame to Optic — the frame is Chalk, the accent is
  the grip and the spark.
- Don't rotate, skew, stretch, outline, or add a shadow to the mark; scale it
  uniformly and leave it alone.
- Don't bake rounded corners or a drop shadow into the app icon — iOS and
  Android apply their own mask and anything pre-baked fights it.
- Don't hand-edit a PNG in `assets/brand/`. It is build output.
- Don't introduce a second accent. If something needs to stand apart from
  Optic, use weight, size, or `line2`.
- Don't carry over any visual language from the infrastructure heritage repo
  (docs/02). The tooling is inherited; the brand is not.

---

## 7. Regenerating

```bash
node scripts/generate-assets.mjs          # render every PNG, then verify it
node scripts/generate-assets.mjs --check   # verify masters + committed PNGs, write nothing
```

The script renders each deliverable, reads it back, and asserts size, colour
type, alpha, and silhouette purity, plus the geometry-drift check across the
masters. It exits non-zero on any failure, so it is safe to wire into CI.

`--check` runs the same assertions against the **committed** PNGs instead of
freshly rendered ones, so it catches a tree whose binaries are stale, hand
edited, or re-saved with an alpha channel — without touching the working tree.

To change something:

| Change | Where |
| --- | --- |
| Mark geometry | `mark.svg`, then mirror into the other masters and re-run |
| Icon background | `icon.svg` only |
| A palette colour | `src/theme/tokens.ts` **and** the SVG masters **and** the tables above, then re-run |
| Asset size or a new deliverable | the `DELIVERABLES` array in `scripts/generate-assets.mjs` |

Two things to know about the pipeline:

- **`wordmark.svg` is deliberately excluded.** It depends on a system font, and
  a font-dependent step would make the app icon render differently on different
  machines. Before using the lockup in print, on the web, or in a store
  screenshot, convert its `<text>` element to outlines in a vector editor.
- **Prose lives inside `<svg>`, never above it.** libvips decides a file is an
  SVG by looking for `<svg` in roughly the first 1 KB; a long comment above the
  root element pushes it out of that window and the file becomes "unsupported
  image format" with no hint as to why. The generator asserts this.

`scripts/generate-placeholder-assets.js` was the baseline's solid-colour
placeholder generator, superseded by this pipeline. It was deleted on `main`
(post-merge audit, 2026-08-15) because running it would have overwritten the
real brand PNGs with the old provisional palette.
