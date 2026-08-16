# features/analysis

The in-app Match Analysis screen: what the offline pipeline (`analysis/` at the repo root)
measured about a match, rendered per player. Reached from the Library — the persistent
"Sample" teaser opens `/analysis?source=demo`, and recordings with an analysis sidecar get a
View-analysis affordance that opens `/analysis?id=<recording id>`. The route file
(`src/app/analysis.tsx`) is a hidden tab (`href: null` in `_layout`), so nothing new shows in
the tab bar.

## The contract

Both sides build to `analysis.json` schemaVersion 1, typed in `types.ts` (pure — the pipeline
can treat that file as the schema reference). Real analyses live as a third sidecar next to
the footage: `<id>.analysis.json` in `<documents>/recordings/` (see `src/lib/analysisSidecar`;
`deleteRecording`'s prefix match cleans it up with the video). Every file read goes through
`parseAnalysis`, which narrows from `unknown`: structural breakage → `null` → the screen's
"not available" state; small numeric drift is clamped.

`demoAnalysis.ts` is PLACEHOLDER data — clearly-plausible hand-written numbers so the screen
is reviewable now; the orchestrator overwrites its values with real analyzed-footage output.

## Module map

| Module | Role |
|---|---|
| `types.ts` | The schemaVersion 1 contract + defensive `parseAnalysis`. Pure — unit-tested. |
| `format.ts` | Percent/count/pattern-label formatting (no `toLocale*`). Pure — unit-tested. |
| `demoAnalysis.ts` | `DEMO_ANALYSIS` placeholder behind the Library "Sample" card. |
| `storage.ts` | Sidecar text (via `src/lib/analysisSidecar`) → `parseAnalysis` → `MatchAnalysis \| null`. |
| `AnalysisScreen.tsx` | Screen shell: back affordance, header, rally stats, player sections, quality footnote, error state. |
| `PlayerSection.tsx` | One player's card: header stats + the three blocks below. |
| `PlacementGrid.tsx` | 2x2 quadrant counts + shares, front wall at the top. |
| `CoverageGrid.tsx` | 12x8 coverage heatmap — accent token at interpolated opacity, no computed hex. |
| `PredictabilityCard.tsx` | Score bar, plain-English top pattern, entropy detail. |
| `RallyStatsRow.tsx` | Rallies / avg shots / longest as stat tiles. |
| `QualityFootnote.tsx` | Frames analyzed, detection rate, audio caveat, pipeline notes. |
