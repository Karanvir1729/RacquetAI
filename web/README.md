# web — RacquetIQ in the browser

A separate Vite + React + TypeScript + Tailwind client. It is **not** the Expo app rendered on
web: it shares the analysis **data contract** (`src/features/analysis/types.ts` at the repo root),
not the components. Nothing here touches the root `package.json`.

```bash
npm install          # from web/
npm run dev          # http://localhost:5183, /api proxied to the analysis server on :8082
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
```

## The design system

Everything visual runs on `--rq-*` CSS custom properties in
[`src/styles/tokens.css`](src/styles/tokens.css), switched by a `data-theme` attribute on `<html>`.
The structure is borrowed from Daybot's storefront (`daybot-dev/frontend/LANDING_DESIGN.md`); the
values are RacquetIQ's own and are expected to agree hex-for-hex with `src/theme/tokens.ts` and
`docs/04-branding.md` at the repo root.

Three rules, and they are not negotiable:

1. **Never write a literal colour in a component.** Read a token — `text-rq-dim`,
   `style={{ color: "var(--rq-text-dim)" }}`. Both resolve to the same custom property.
   `tailwind.config.js` binds the `rq-*` colour classes to the variables.
2. **Accent fill is constant; accent text is not.** `--rq-accent` (Optic `#D8FA3C`) stays the same
   in both themes and always carries `--rq-on-accent` ink text. Optic as *text* is illegible on the
   light canvas, so accent-coloured type and icons use `--rq-accent-text`, which deepens to Court
   Green in light mode. Thin data marks — meters, heat cells, the T dot — use `--rq-data`, which
   deepens for the same reason.
3. **Sections alternate.** `--rq-bg` and `--rq-panel` bands, each with a 1px `--rq-line` top
   border. That banding is most of what makes the page feel considered.

## Primitives

| Module | What it gives you |
|---|---|
| `components/ui/Button.tsx` | `Button` / `ButtonLink`, 4 variants x 3 sizes, all ≥44px tall |
| `components/ui/Card.tsx` | `Card` (the one card recipe), `IconChip`, `Hairline` |
| `components/ui/Section.tsx` | `Section` (band + container + rhythm), `SectionHead` |
| `components/ui/Chip.tsx` | `AccentBadge`, `Chip`, `GlassChip` |
| `components/ui/Stat.tsx` | `Stat` (tabular figures), `Meter` |
| `components/ui/Reveal.tsx` | the one entrance animation; honours `prefers-reduced-motion` |
| `components/CourtPlan.tsx` | squash court in plan view with a coverage heatmap on it |
| `components/brand/Mark.tsx` | the mark and the wordmark, theme-aware |
| `theme/ThemeProvider.tsx` | `useTheme()`; follows the OS until the visitor picks, then persists |
| `lib/useDocumentTitle.ts` | per-route `<title>` |
| `lib/useElementSize.ts` | live border-box size; what the overlay and picker measure against |

Type comes from the `.rq-hero` / `.rq-h2` / `.rq-h3` / `.rq-lead` / `.rq-body` / `.rq-label` /
`.rq-caption` / `.rq-eyebrow` classes in `src/styles/index.css`. Weights are 400 / 600 / 800 only.

## The analysis flow

`/analyze` is the whole journey and `/demo` is the same read-out fed by a bundled sample.

```
src/analysis/            the contract, ported from src/features/analysis/ at the repo root
  types.ts               schemaVersion 1 + 2, and the defensive parse. A MIRROR, not a fork
  letterbox.ts           contain-fit maths, plus the UNCLAMPED variant the picker needs
  pose.ts                bones, joints, nearest-sample lookup — SVG segments instead of RN bars
  shots.ts / format.ts   shot selection and the exact display strings the app uses
  jobContract.ts         POST /jobs → GET /jobs/<id> → corners → analysis.json, narrowed
  client.ts              fetch/XHR layer; XHR for the upload because it reports progress
  useJobFlow.ts          the stage machine: idle → uploading → waiting → corners → analyzing → done
src/components/analysis/ UploadPanel, CornerPicker, FlowProgress, MatchPlayer, PoseOverlay,
                         PlayerPanel, PlacementGrid, ShotTypeBars, QualityFootnote, ResultsView
```

Four things in there are easy to break and expensive to notice:

- **Corners are never clamped.** `POST /jobs/<id>/corners` accepts normalized values outside
  0..1 because a court corner can sit outside the camera frame. The picker draws the frame inside
  a hatched margin so those corners have somewhere to go, and sends `-0.14` as `-0.14`.
- **Every overlay coordinate goes through `containRect`.** The video and the reference frame both
  render `object-fit: contain`; measuring against the element instead of the drawn picture puts
  the skeleton off the players by the width of a letterbox bar.
- **`--rq-overlay-*` do not flip with the theme.** They paint the skeleton and the picker
  crosshair onto footage, not onto the page. Wiring player B to `--rq-text` looked right in dark
  mode and turned the figure near-black over a dark shirt in light mode.
- **The playhead is driven by rAF *and* by `timeupdate`/`seeked`.** rAF alone stops in a
  background tab and under power saving, which strands the read-out on a stale moment.

The job id is mirrored into `?job=`, so a reload rejoins a running analysis. The video on the
results page is the visitor's own local file via an object URL — the server never sends footage
back. Rejoining in a fresh tab therefore shows the measurements with no video, and says so.

### Where the server is

The site has no backend. `npm run dev` proxies `/api` to `analysis/server.py` on :8082; a deployed
build takes `VITE_ANALYSIS_API` at build time, and the visitor can point it somewhere else at
runtime from the "Analysis server" panel (persisted in `localStorage`).

### The bundled sample

`public/sample/analysis.json` is a byte copy of `analysis/out/archive_match2_v2/analysis.json`
(schema v2, 320 shots, 3381 pose samples). `public/sample/match.mp4` is the footage it was
computed from, re-encoded for the web — 44 MB → 14 MB:

```bash
ffmpeg -i analysis/samples/archive_match2.mp4 -vf "scale='min(854,iw)':-2" \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -profile:v main \
  -map 0:v:0 -map "0:a:0?" -c:a aac -b:a 40k -ac 1 -movflags +faststart \
  web/public/sample/match.mp4
```

It is fetched at runtime rather than imported, so the two megabytes of pose track stay out of the
JS bundle *and* the demo travels the same parse path a real job does.

The hero's numbers live in `src/data/heroMatch.ts` and are copied verbatim out of that same
analysis file. Keep it that way: nothing on this site should quote a number the pipeline did not
produce.

## Honesty

The site must not claim live/real-time tracking, coaching advice, or any sport but squash. Shot
detection was audited at roughly 63% precision and shot *types* are frequently unverifiable at
854×480 — the "Limits" section on the landing page says so, the quality footnote under every
read-out repeats it, and any new copy has to stay consistent with both. The shot-mix chart keeps
"Unclassified" as a visible bar for the same reason: it is the honest measure of how much of the
match the classifier would not commit on.
