# 04 — Branding

The RacquetIQ identity: palette, mark, type, and the asset pipeline that turns
four SVGs into every PNG the app ships.

The product ships as **RacquetIQ** (`expo.name`, the web wordmark). The repo,
the Expo `slug` and the URL `scheme` are all still `racquetai` and are staying
that way — they are load-bearing for EAS builds and store linkage, and renaming
them buys nothing a user can see.

Owned by **feat/branding**. The palette below has two machine-readable copies —
`src/theme/tokens.ts` for the app and `web/src/styles/tokens.css` for the web —
and this doc plus both files are expected to agree hex for hex. A colour changed
in one is a colour changed in all three.

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
| **Chalk** | `#FFFFFF` | Court lines, the spark at the mark's sweet spot, primary text on dark. |
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
| `accentLine` ᵂ | `rgba(216,250,60,0.32)` | `rgba(31,107,74,0.26)` |
| `data` | `#D8FA3C` | `#1F6B4A` |
| `onAccent` | `#06130E` | `#06130E` |
| `glow` | `rgba(216,250,60,0.35)` | `rgba(31,107,74,0.22)` |
| `danger` | `#FF6B6B` | `#C62F26` |
| `dangerSoft` | `rgba(255,107,107,0.12)` | `rgba(198,47,38,0.10)` |
| `scrim` | `rgba(0,0,0,0.60)` | `rgba(6,19,14,0.45)` |
| `surfaceWhite` | `#FFFFFF` (both) | |
| `inkOnWhite` | `#06130E` (both) | |
| `overlayA` | `#D8FA3C` (both) | |
| `overlayB` | `#FFFFFF` (both) | |
| `overlayCasing` | `#06130E` (both) | |

ᵂ `accentLine` currently exists only on the web, as `--rq-accent-line`; the app
has no equivalent yet. Every other row is in both token files.

`accent` is the one token that does **not** flip: a tennis ball is the same
colour in both themes, and Optic holds up as a *fill* on either canvas. It is
only as text that it breaks, which is what `accentText` exists for — and
`data` is the same substitution for a mark that is drawn rather than typed
(heat cells, meter fills, the T), because Optic at low opacity on a white
canvas is nothing at all.

The **overlay trio** does not flip either, and for a different reason. Those
three paint the pose skeleton *on the video*, not on the page: a squash court
is a bright wall and a pale floor whichever theme the user picked, so the
figures have to hold up against the footage. Wire one of them to a page token
and the skeleton disappears over a dark-shirted player in light mode.

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

`textFaint` is the **disabled/pending tier** — "Coming soon" rows, placeholder
text, an unreached step's number, a dimmed pip, a watermark — and it sits below
AA on light on purpose, because it marks unavailable controls, which WCAG
exempts. Never set body copy, a value the user has to read, or the label of an
*enabled* control in `textFaint`; that is what `textDim` is for.

An unselected tab label is **not** an exception. The tab is tappable, so it is
an enabled control and takes `textDim` — unselected means not-current, not
unavailable. The ramp is three tiers and stays three tiers: `text` primary,
`textDim` secondary and readable, `textFaint` genuinely inactive.

---

## 3. The mark — "Ace Spark"

A geometric racquet seen head-on and tilted, with a four-point AI spark sitting
at the sweet spot where the strings cross. The racquet says which sport; the
spark says the software is watching. The frame carries **Optic** — the loudest
value in the palette on the largest shape, which is what makes the icon findable
on a home screen — and the spark is **Chalk**, the one value bright enough to
out-rank Optic, so the eye lands on the sweet spot and nowhere else.

### Construction

Drawn on a **512 × 512** grid. Ink box is **224 × 400** (78% of the grid tall),
centred on (256, 256) to the pixel.

| Element | Geometry |
| --- | --- |
| Frame | ellipse, centre (0,−87), rx 78, ry 96, stroke 34, **Optic** |
| Throat + grip | **one** closed path from the frame's shoulders to the grip butt, leaving the frame tangentially — head and handle are a single line, no separate grip pill to sit off axis. **Optic** |
| String bed | 10 mains × 12 crosses, 13-unit pitch, stroke 2.8, Optic at 18% **group** opacity (stroke opacity would double-darken every crossing into noise), clipped inside the frame |
| Spark | 4-point star, r 42, **Chalk**, on the sweet spot, counter-rotated −20° so it stays upright |
| Whole mark | rotated **+20°** (head to the upper right), uniform scale 1.0416 |

The outer translate in the SVG is `235.25 256.85`, not `256 256`. That is
deliberate: the racquet is a diagonal shape, so its tight ink box is not
centred on its own rotation origin. The offset makes the ink box land dead
centre, which is what lets every downstream asset scale the file about its
centre and trust the result.

The spark is counter-rotated so that it reads as a *spark* (upright, symmetric)
rather than as a tilted diamond. This is the one place the mark breaks its own
rotation, and it is intentional.

### Clear space

**Clear space = the height of the spark**, on all four sides. At lockup scale
that is 72 units. Nothing enters it: no type, no canvas edge, no photo, no UI
chrome. It is also the gap between the mark and the wordmark, which is why the
lockup feels like one object rather than two.

### Minimum sizes

| Use | Minimum |
| --- | --- |
| Full-colour mark | 32 px — below this the string bed turns to mush; use the mono mark |
| Monochrome mark | 20 px |
| Horizontal lockup | 160 px wide — below this drop the wordmark and use the mark alone |

### On light surfaces

The mark's frame is Optic, which is **illegible on a light background**
(1.1:1 against Chalk Wash). Use `mark-mono.svg` recoloured to Court Ink, or
place the full-colour mark on a Court Ink tile. Never outline the mark to
rescue it.

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

**The wordmark** is "RacquetIQ" — the name the product ships under (`expo.name`
in app.json, and what `web/src/components/brand/Mark.tsx` renders). It is the
same face at weight 800, tracked ≈ −0.035 em, which sets the name as one word.
"Racquet" takes `text` and "IQ" takes `accentText`, so the accent half deepens
to Court Green on light instead of vanishing; Optic itself is never used here,
because a wordmark is ink. The colour break is the *only* separation: no space,
no second capital in the middle, no camel-case gap.

The expo `slug` and `scheme` are still `racquetai`. Leave them — they are the
EAS project and store linkage, not brand surface.

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
| `wordmark.svg` | Horizontal lockup, mark + "RacquetIQ". |

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
- Don't recolour the mark's frame to Chalk — the frame carries Optic, and
  Chalk is reserved for the spark. One focal point.
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
node scripts/generate-assets.mjs --check   # verify the masters only, write nothing
```

The script renders each deliverable, reads it back, and asserts size, colour
type, alpha, and silhouette purity, plus the geometry-drift check across the
masters. It exits non-zero on any failure, so it is safe to wire into CI.

To change something:

| Change | Where |
| --- | --- |
| Mark geometry | `mark.svg`, then mirror into the other masters and re-run |
| Icon background | `icon.svg` only |
| A palette colour | `src/theme/tokens.ts` **and** `web/src/styles/tokens.css` **and** the SVG masters **and** the tables above, then re-run |
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
