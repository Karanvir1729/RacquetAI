# RacquetAI — v0 squash shot-placement analysis pipeline

Turns a single fixed(ish)-camera recording of a squash match into per-player
placement stats, coverage heatmaps, T-control and predictability scores,
plus a pose track and a type for every shot, written as `analysis.json`
(schemaVersion 2 — the contract shared with the app; v1 files still open).

## Quick start

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python analyze.py \
    --video samples/archive_match1.mp4 \
    --corners samples/archive_match1.corners.json \
    --out out/archive_match1
```

Outputs in `--out`: `analysis.json`, 8 pose+court overlay frames,
`heatmap_A.png` / `heatmap_B.png`, `onsets.png`.

## How it works

1. **Decode + sample** (~8 fps) with OpenCV.
2. **Camera drift compensation** — every sampled frame is ORB-matched (RANSAC)
   to the calibration reference frame, so handheld/bumped cameras still map to
   the same court geometry. Falls back to the last good alignment.
3. **Court homography** — `<clip>.corners.json` holds the pixel coords of the 4
   floor corners in the reference frame (corners may be outside the frame; they
   are derived by `tools/fit_court.py`, which least-squares fits the homography
   from observed *floor lines* — short line, service boxes, half-court line —
   because real camera angles rarely show all 4 corners).
4. **Pose** — rtmlib RTMPose (`balanced`, CPU ONNX). Detections whose ankle
   midpoint projects outside the court (+0.8 m margin) are discarded (kills
   spectators/reflections); the two largest remaining boxes are kept.
5. **Two-player tracking** — nearest-neighbor on court-space ankle midpoints
   with a swap guard (identities only swap when clearly better).
6. **Shot moments** — librosa spectral-flux onsets on the extracted audio
   (mono 22.05 kHz, `ffmpeg -vn`), merged below 0.35 s. Without audio: wrist-speed
   peak fallback (`quality.audioAvailable=false`).
7. **Striker attribution** — player with the larger scale-normalized wrist
   travel in a ±0.25 s window around the onset (ankle-speed fallback).
8. **Placement (retrieval proxy)** — shot *k* by player P is assigned the court
   cell where the *opponent* strikes shot *k+1* (2×2 grid, front/back split at
   the short line y=5.44 m, left/right at x=3.2 m). The last shot of each rally
   has no retrieval and is dropped. Rallies split on onset gaps > 8 s.
9. **Analytics** — placement counts, 12×8 coverage heatmap (row 0 = front wall,
   max-normalized), `tTimePct` (≤1.5 m from the T at (3.2, 5.44)),
   `predictability = 1 − H/Hmax` where H is the entropy rate of the player's
   first-order placement-cell transition matrix (Hmax = log2 4 = 2 bits).

## Calibrating a new clip

1. Extract a mid-clip frame (`ffmpeg -ss <t> -frames:v 1`).
2. Note pixel points along known floor lines into `<clip>.lines.json`
   (see `samples/*.lines.json` for the format; court frame: x∈[0,6.4] left→right,
   y∈[0,9.75] front→back, short line y=5.44, boxes 1.6 m).
3. `tools/fit_court.py --spec ... --frame ... --out-corners <clip>.corners.json
   --out-overlay check.png` — then LOOK at `check.png`: projected lines must sit
   on the painted lines.
4. Optional sidecar `<clip>.meta.json` with `source` and `license` strings
   (copied into `analysis.json`).

## Known v0 limitations

- Placement is a *proxy* (opponent's retrieval position), not ball tracking —
  winners/errors and the final shot of every rally are invisible to it.
- Audio onsets include ball bounces, shoe squeaks and echoes; shot counts are
  approximate (bounces within 0.35 s of the hit are merged, others are not).
- Striker attribution by wrist motion is weakest when both players swing or the
  striker is occluded — expect some misattributed shots.
- Behind-glass footage: mullions/reflections occasionally hide a player;
  `quality.bothPlayersDetectedPct` reports how often both were tracked.
- Court calibration on partially visible courts extrapolates the far side wall;
  positions near the un-observed wall carry the largest error (~0.3-0.5 m).
- `tools/stability_scan.py` exists but phase correlation on the wall strip is
  unreliable for these clips; the ORB alignment in the main pipeline is what
  actually handles camera motion.
