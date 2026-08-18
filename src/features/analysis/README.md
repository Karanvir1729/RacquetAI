# features/analysis

The in-app Match Analysis screen: what the offline pipeline (`analysis/` at the repo root)
measured about a match, rendered per player. Reached from the Library — the persistent
"Sample" teaser opens `/analysis?source=demo`, and recordings with an analysis sidecar get a
View-analysis affordance that opens `/analysis?id=<recording id>`. The route file
(`src/app/analysis.tsx`) is a hidden tab (`href: null` in `_layout`), so nothing new shows in
the tab bar.

The feature also owns the **import flow** (`/import-analysis`, also a hidden tab): the
Library's "Import & analyze" card picks a video, and `useImportFlow` dispatches it to one of
two backends (`backend.ts`, chosen in Settings, default "device"):

- **On this device** — the `racquet-analyzer` Expo local module
  (`modules/racquet-analyzer/`, loaded via require-in-try/catch so Expo Go degrades to the
  server path instead of crashing): extract a mid-video reference frame, corner taps on that
  local frame, then `analyzeMatch` with `analysisProgress` events driving the progress UI.
- **Analysis server** — upload to the server (base URL in Settings via `ServerConfigCard`,
  default `http://localhost:8082`), poll job status, corner taps on the server's reference
  frame.

Both paths collect the four floor-corner taps with the same `CornerPicker`, validate the
resulting `analysis.json` with `parseAnalysis`, persist it as `<imp-id>.analysis.json`
(`src/lib/importedAnalyses`) and replace themselves with `/analysis?id=<imp-id>`.

## The contract

Both sides build to `analysis.json`, typed in `types.ts` (pure — the pipeline can treat that
file as the schema reference). Real analyses live as a third sidecar next to the footage:
`<id>.analysis.json` in `<documents>/recordings/` (see `src/lib/analysisSidecar`;
`deleteRecording`'s prefix match cleans it up with the video). Every file read goes through
`parseAnalysis`, which narrows from `unknown`: structural breakage → `null` → the screen's
"not available" state; small numeric drift is clamped.

**schemaVersion 2** is purely additive over 1 and BOTH parse — v1 sidecars are already on
users' phones, and reading one must keep working:

- `tracks`: pose keypoints sampled at ~8 Hz, `{ t, p: [{ id, k }] }` where `k` is 17 COCO
  keypoints x `[x, y, conf]` flattened, x/y normalized against `video.width`/`video.height`.
  Drives the skeleton overlay on the match video.
- `type` / `typeConfidence` on each shot: `serve`/`drive`/`crossCourt`/`drop`/`boast`/`volley`
  /`unknown`. There is deliberately no `lob` — without ball tracking it is indistinguishable
  from a drive, so those come back `unknown`.

A v1 file simply has neither, and the UI treats absence as "no skeleton, no types" rather than
as an error. Malformed v2 detail degrades the same way: a pose whose `k` is the wrong length,
holds a NaN, or claims a confidence outside 0..1 is dropped on its own, and an unreadable shot
type is stripped while the shot itself survives.

`demoAnalysis.ts` is PLACEHOLDER data — clearly-plausible hand-written numbers so the screen
is reviewable now; the orchestrator overwrites its values with real analyzed-footage output.

## Module map

| Module | Role |
|---|---|
| `types.ts` | The schemaVersion 1 + 2 contract and defensive `parseAnalysis`. Pure — unit-tested. |
| `format.ts` | Percent/count/pattern/shot-type label formatting (no `toLocale*`). Pure — unit-tested. |
| `shots.ts` | Shot-type counts per player + which shot the playhead is on. Pure — unit-tested. |
| `pose.ts` | Overlay geometry: nearest track sample, letterbox-corrected bone/joint layout. Pure — unit-tested. |
| `demoAnalysis.ts` | `DEMO_ANALYSIS` placeholder behind the Library "Sample" card. |
| `storage.ts` | Sidecar text (via `src/lib/analysisSidecar`) → `parseAnalysis` → `MatchAnalysis \| null`. |
| `AnalysisScreen.tsx` | Screen shell: back affordance, header, rally stats, player sections, quality footnote, error state. |
| `PlayerSection.tsx` | One player's card: header stats, shot-type breakdown, and the three blocks below. |
| `MatchVideoCard.tsx` | Inline expo-video player, pose overlay on top, live read-out of the shot being played. |
| `PoseOverlay.tsx` | The skeletons: plain absolutely-positioned Views (no native SVG dependency), one colour per player. |
| `PlacementGrid.tsx` | 2x2 quadrant counts + shares, front wall at the top. |
| `CoverageGrid.tsx` | 12x8 coverage heatmap — accent token at interpolated opacity, no computed hex. |
| `PredictabilityCard.tsx` | Score bar, plain-English top pattern, entropy detail. |
| `RallyStatsRow.tsx` | Rallies / avg shots / longest as stat tiles. |
| `QualityFootnote.tsx` | Frames analyzed, detection rate, audio caveat, pipeline notes. |
| `jobContract.ts` | The analysis-server HTTP contract: endpoints, status/jobId parsing, corners payload. Pure — unit-tested. |
| `letterbox.ts` | Contain-fit geometry: view taps ↔ normalized frame coords. Pure — unit-tested. |
| `serverConfig.ts` | Persisted server base URL (`<documents>/analysis-server.json`, sidecar pattern). |
| `backend.ts` | Backend choice ("device"/"server"): persisted setting, module availability, `resolveBackend` fallback. Pure parts unit-tested. |
| `deviceClient.ts` | racquet-analyzer wrapper: require-in-try/catch loader, frame extraction, `analyzeMatch` + progress→JobStatus mapping, corners/options JSON. Unit-tested. |
| `importClient.ts` | The only HTTP layer: multipart upload task, status poll, corners POST, analysis fetch. |
| `importFlowState.ts` | The shared flow-state union both machines drive and the screen renders. |
| `useImportFlow.ts` | Entry hook: resolves the backend, dispatches; owns the server machine (upload → poll → corners → validate + persist). |
| `useDeviceImportFlow.ts` | Device machine: extract frame → corners → on-device analyze with progress → validate + persist. |
| `ImportAnalysisScreen.tsx` | Flow screen: stage list with progress for either backend, error + retry, handoff to `/analysis`. |
| `CornerPicker.tsx` | Reference frame + numbered corner taps (Front left → Front right → Back left → Back right). |
| `ServerConfigCard.tsx` | Settings "Analysis" card: backend choice (device disabled in Expo Go) + show/edit the server URL with the LAN-IP hint. |
