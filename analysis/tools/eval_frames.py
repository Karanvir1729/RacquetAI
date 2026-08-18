#!/usr/bin/env python3
"""Frame views for hand-labelling shot moments. Two modes.

`--mode moment` — one 3x2 grid per moment, cropped tight around the players:

    t-0.30   t-0.15   t=0.00        (t=0 tile has a yellow border)
    t+0.15   t+0.30   whole frame   (cyan border, court-wide context)

`--mode strip` — one 4x2 grid per window, a fixed-step filmstrip at half
resolution used to label a stretch of video exhaustively (recall):

    t0  t0+s  t0+2s  t0+3s
    t0+4s t0+5s t0+6s t0+7s

Both modes outline the engine's tracked players so the labeller can name the
striker in the engine's own ID space: GREEN = player A, MAGENTA = player B.

    .venv/bin/python tools/eval_frames.py --video samples/archive_match2.mp4 \
        --boxes eval/boxes_archive_match2.json --mode moment \
        --times 161.29 --outdir /tmp/frames --tag m2
"""
import argparse
import bisect
import json
import os
import subprocess

W, H = 854, 480
TILE_W, TILE_H = 420, 240      # moment mode; grid 3x2 -> 1260x720
STRIP_W, STRIP_H = 427, 240    # strip mode; grid 4x2 -> 1708x480 (half res)
PAD_FRAC = 0.40
OFFSETS = (-0.30, -0.15, 0.0, 0.15, 0.30)
COLORS = {"A": "0x00ff00", "B": "0xff00ff"}


def _boxes_at(plan, t):
    """Tracked A/B boxes at the sample time nearest t."""
    times = plan["times"]
    i = bisect.bisect_left(times, t)
    cands = [j for j in (i - 1, i) if 0 <= j < len(times)]
    if not cands:
        return {}
    j = min(cands, key=lambda j: abs(times[j] - t))
    return plan["players"][j]


def crop_box(plan, t, span, tile_w, tile_h):
    times = plan["times"]
    lo = bisect.bisect_left(times, t - span)
    hi = bisect.bisect_right(times, t + span)
    sel = [b for r in plan["players"][lo:hi] for b in r.values()]
    if not sel:
        return (0, 40, W, H - 80)
    x0 = min(b[0] for b in sel)
    y0 = min(b[1] for b in sel)
    x1 = max(b[2] for b in sel)
    y1 = max(b[3] for b in sel)
    pad = PAD_FRAC * max(y1 - y0, 40)
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = max(x1 - x0, tile_w * 0.7), max(y1 - y0, tile_h * 0.7)
    ar = tile_w / tile_h
    w, h = (h * ar, h) if w / h < ar else (w, w / ar)
    w, h = min(w, W), min(h, H)
    x0 = min(max(cx - w / 2, 0), W - w)
    y0 = min(max(cy - h / 2, 0), H - h)
    return (int(x0), int(y0), int(w), int(h))


def _tile(video, tt, vf, path):
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(tt, 0):.3f}", "-i", video,
                    "-frames:v", "1", "-vf", vf, "-y", path], check=True)


def _player_boxes_vf(plan, tt, box, tile_w, tile_h):
    """drawbox filters for A/B, in the coordinate frame after crop+scale."""
    sx, sy = tile_w / box[2], tile_h / box[3]
    out = ""
    for pid, b in _boxes_at(plan, tt).items():
        x = (b[0] - box[0]) * sx
        y = (b[1] - box[1]) * sy
        w = (b[2] - b[0]) * sx
        h = (b[3] - b[1]) * sy
        if x + w < 0 or y + h < 0 or x > tile_w or y > tile_h:
            continue
        out += (f",drawbox=x={x:.0f}:y={y:.0f}:w={w:.0f}:h={h:.0f}:"
                f"color={COLORS[pid]}:t=2")
    return out


def moment4(video, t, plan, out_png):
    """Cheap 2x2 zoom: t-0.25, t-0.08 / t+0.08, t+0.25, tight crop, no wide tile."""
    offs = (-0.25, -0.08, 0.08, 0.25)
    box = crop_box(plan, t, 0.35, TILE_W, TILE_H)
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    tiles = []
    for k, off in enumerate(offs):
        p = os.path.join(tmp, f"{k}.png")
        vf = (f"crop={box[2]}:{box[3]}:{box[0]}:{box[1]},"
              f"scale={TILE_W}:{TILE_H}:flags=lanczos")
        vf += _player_boxes_vf(plan, t + off, box, TILE_W, TILE_H)
        vf += ",drawbox=x=0:y=0:w=iw:h=ih:color=white:t=1"
        _tile(video, t + off, vf, p)
        tiles.append(p)
    _stack(tiles, 2, 2, out_png)
    return out_png


def moment(video, t, plan, out_png):
    box = crop_box(plan, t, 0.45, TILE_W, TILE_H)
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    tiles = []
    for k, off in enumerate(OFFSETS):
        p = os.path.join(tmp, f"{k}.png")
        vf = (f"crop={box[2]}:{box[3]}:{box[0]}:{box[1]},"
              f"scale={TILE_W}:{TILE_H}:flags=lanczos")
        vf += _player_boxes_vf(plan, t + off, box, TILE_W, TILE_H)
        if abs(off) < 1e-6:
            vf += ",drawbox=x=0:y=0:w=iw:h=ih:color=yellow:t=5"
        _tile(video, t + off, vf, p)
        tiles.append(p)
    wide = os.path.join(tmp, "wide.png")
    _tile(video, t, f"scale={TILE_W}:{TILE_H}:flags=lanczos"
                    + _player_boxes_vf(plan, t, (0, 0, W, H), TILE_W, TILE_H)
                    + ",drawbox=x=0:y=0:w=iw:h=ih:color=cyan:t=4", wide)
    tiles.append(wide)
    _stack(tiles, 3, 2, out_png)
    return out_png


def strip(video, t0, step, plan, out_png, cols=4, rows=2):
    # never crop in strip mode: the window is labelled exhaustively, so a crop
    # that clipped a corner of the court would silently cost recall
    n = cols * rows
    box = (0, 0, W, H)
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    tiles = []
    for k in range(n):
        tt = t0 + k * step
        p = os.path.join(tmp, f"{k}.png")
        vf = (f"crop={box[2]}:{box[3]}:{box[0]}:{box[1]},"
              f"scale={STRIP_W}:{STRIP_H}:flags=lanczos")
        vf += _player_boxes_vf(plan, tt, box, STRIP_W, STRIP_H)
        vf += ",drawbox=x=0:y=0:w=iw:h=ih:color=white:t=1"
        _tile(video, tt, vf, p)
        tiles.append(p)
    _stack(tiles, cols, rows, out_png)
    return out_png


def _stack(tiles, cols, rows, out_png):
    inputs = []
    for p in tiles:
        inputs += ["-i", p]
    fc = ""
    for r in range(rows):
        idx = "".join(f"[{r * cols + c}]" for c in range(cols))
        fc += f"{idx}hstack=inputs={cols}[r{r}];"
    fc += "".join(f"[r{r}]" for r in range(rows)) + f"vstack=inputs={rows}"
    subprocess.run(["ffmpeg", "-v", "error", *inputs, "-filter_complex", fc,
                    "-y", out_png], check=True)
    for p in tiles:
        os.remove(p)
    os.rmdir(os.path.dirname(tiles[0]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--boxes", required=True)
    ap.add_argument("--mode", choices=("moment", "moment4", "strip"), default="moment")
    ap.add_argument("--times", required=True, help="comma separated seconds")
    ap.add_argument("--step", type=float, default=0.2, help="strip mode frame step")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--tag", default="m")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    plan = json.load(open(args.boxes))
    for t in [float(x) for x in args.times.split(",")]:
        out = os.path.join(args.outdir, f"{args.tag}_{t:08.3f}.png")
        if args.mode == "moment":
            moment(args.video, t, plan, out)
        elif args.mode == "moment4":
            moment4(args.video, t, plan, out)
        else:
            strip(args.video, t, args.step, plan, out)
        print(out)


if __name__ == "__main__":
    main()
