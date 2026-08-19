#!/usr/bin/env python3
"""Zoomed frame views for hand-labelling the BALL. Viewing only — no detection.

A squash ball is ~2-3 px at 854x480, so it cannot be labelled from a montage at
native scale. Every view here magnifies with NEAREST-neighbour so the labeller
sees the actual sensor pixels rather than interpolation, and every view prints
the pixel coordinate frame it was cut from, so a click in the view maps back to
source pixels without arithmetic by hand.

Modes
-----
full   one image per frame, whole frame magnified to fit the read budget.
       Coarse search / context.
quad   one frame cut into overlapping tiles (default 2x2), each magnified ~3.6x.
       Exhaustive search of a single frame: this is what "a human looked
       properly and it was not there" means.
strip  N consecutive frames, each cropped around a per-frame centre and
       magnified, laid out in a grid. The workhorse: the eye finds a 3 px ball
       by its motion across consecutive tiles, not in any one tile.

Coordinates are always source-video pixels (854x480 unless --scale-note says
otherwise). Grid overlays are drawn OUTSIDE the image content (in the caption
bar and as 1 px ticks on the border) so nothing is painted over the ball.

    .venv/bin/python tools/ball_frames.py --video samples/archive_match3.mp4 \
        --mode strip --start 6200 --n 6 --center 400,250 --box 200,150 \
        --outdir /tmp/ball --tag m3
"""
import argparse
import json
import os

import cv2
import numpy as np

# Read budget. Emitting a bigger image than the reader will accept is worse than
# useless: it gets downscaled on the way in, silently undoing the magnification
# these views exist to provide. ~1.05 MP keeps every emitted pixel.
MAX_W, MAX_H = 1400, 1040
STRIP_MAX_H = 790  # a 6-tile grid is wider than it is tall; keep the area equal
CAPTION_H = 26
FONT = cv2.FONT_HERSHEY_SIMPLEX


def read_frames(video, start, n):
    """Exact frame reads: seek near, then decode forward. Returns {idx: bgr}."""
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {video}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    got = {}
    idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
    if idx != start:  # some builds land early; roll forward
        while idx < start:
            ok, _ = cap.read()
            if not ok:
                break
            idx += 1
    for k in range(n):
        ok, fr = cap.read()
        if not ok:
            break
        got[start + k] = fr
    cap.release()
    return got


def caption(img, text, color=(255, 255, 255)):
    """Add a caption bar ABOVE the image; never paint on the pixels."""
    bar = np.zeros((CAPTION_H, img.shape[1], 3), np.uint8)
    bar[:] = (40, 40, 40)
    cv2.putText(bar, text, (6, 18), FONT, 0.5, color, 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def magnify(img, zoom):
    return cv2.resize(img, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_NEAREST)


def ticks(img, x0, y0, zoom, step=20):
    """1 px ruler marks on the top/left border of a magnified crop."""
    out = img.copy()
    h, w = out.shape[:2]
    sx = x0 - (x0 % step) + step
    while (sx - x0) * zoom < w:
        px = int((sx - x0) * zoom)
        cv2.line(out, (px, 0), (px, 5), (0, 200, 255), 1)
        sx += step
    sy = y0 - (y0 % step) + step
    while (sy - y0) * zoom < h:
        py = int((sy - y0) * zoom)
        cv2.line(out, (0, py), (5, py), (0, 200, 255), 1)
        sy += step
    return out


AX_L, AX_T = 40, 18  # left / top ruler margins, in view pixels


def axes(img, x0, y0, zoom, step=20):
    """Wrap a magnified crop in rulers labelled in SOURCE pixels.

    The labeller reads a coordinate straight off the margins instead of doing
    (view/zoom + origin) arithmetic in their head for every frame — the single
    biggest source of silent label error in a job this size. Rulers live outside
    the image content, so no pixel of the crop is painted over.
    """
    h, w = img.shape[:2]
    out = np.zeros((h + AX_T, w + AX_L, 3), np.uint8)
    out[:] = (30, 30, 30)
    out[AX_T:, AX_L:] = img
    sx = x0 - (x0 % step) + step
    while (sx - x0) * zoom < w:
        px = AX_L + int((sx - x0) * zoom)
        cv2.line(out, (px, AX_T - 4), (px, AX_T + 3), (0, 200, 255), 1)
        cv2.putText(out, str(sx), (px - 11, AX_T - 6), FONT, 0.32,
                    (0, 200, 255), 1, cv2.LINE_AA)
        sx += step
    sy = y0 - (y0 % step) + step
    while (sy - y0) * zoom < h:
        py = AX_T + int((sy - y0) * zoom)
        cv2.line(out, (AX_L - 4, py), (AX_L + 3, py), (0, 200, 255), 1)
        cv2.putText(out, str(sy), (2, py + 4), FONT, 0.32, (0, 200, 255), 1,
                    cv2.LINE_AA)
        sy += step
    return out


def crop(frame, cx, cy, bw, bh):
    """Clamped crop; returns (img, x0, y0)."""
    H, W = frame.shape[:2]
    x0 = int(round(cx - bw / 2))
    y0 = int(round(cy - bh / 2))
    x0 = max(0, min(x0, W - bw))
    y0 = max(0, min(y0, H - bh))
    bw = min(bw, W)
    bh = min(bh, H)
    return frame[y0:y0 + bh, x0:x0 + bw], x0, y0


def mode_full(frames, outdir, tag, zoom=None):
    out = []
    for i, fr in sorted(frames.items()):
        H, W = fr.shape[:2]
        z = zoom or min(MAX_W / W, MAX_H / H)
        img = cv2.resize(fr, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
        img = caption(img, f"{tag} FULL f{i}  src {W}x{H}  zoom {z:.2f}x "
                           f"(view_x/{z:.2f} = src_x)")
        p = os.path.join(outdir, f"{tag}_full_f{i}.png")
        cv2.imwrite(p, img)
        out.append(p)
    return out


def mode_quad(frames, outdir, tag, cols=2, rows=2, overlap=0.08):
    out = []
    for i, fr in sorted(frames.items()):
        H, W = fr.shape[:2]
        tw, th = W / cols, H / rows
        ow, oh = tw * overlap, th * overlap
        for r in range(rows):
            for c in range(cols):
                x0 = int(max(0, c * tw - ow))
                y0 = int(max(0, r * th - oh))
                x1 = int(min(W, (c + 1) * tw + ow))
                y1 = int(min(H, (r + 1) * th + oh))
                sub = fr[y0:y1, x0:x1]
                z = min((MAX_W - AX_L) / sub.shape[1],
                        (MAX_H - AX_T - CAPTION_H) / sub.shape[0])
                img = axes(magnify(sub, z), x0, y0, z, step=40)
                img = caption(img, f"{tag} QUAD f{i} r{r}c{c}  src x[{x0},{x1}) "
                                   f"y[{y0},{y1})  zoom {z:.2f}x  ticks=20px")
                p = os.path.join(outdir, f"{tag}_quad_f{i}_r{r}c{c}.png")
                cv2.imwrite(p, img)
                out.append(p)
    return out


def mode_strip(frames, outdir, tag, centers, box, cols=3):
    """One image: consecutive frames, each cropped around its own centre."""
    bw, bh = box
    idxs = sorted(frames)
    rows = int(np.ceil(len(idxs) / cols))
    z = min((MAX_W - cols * AX_L) / (cols * bw),
            (STRIP_MAX_H - rows * (CAPTION_H + AX_T)) / (rows * bh))
    z = max(1.0, z)
    tiles = []
    meta = []
    for k, i in enumerate(idxs):
        cx, cy = centers[min(k, len(centers) - 1)]
        sub, x0, y0 = crop(frames[i], cx, cy, bw, bh)
        img = axes(magnify(sub, z), x0, y0, z)
        img = caption(img, f"f{i}  x0={x0} y0={y0} z={z:.1f}x")
        cv2.rectangle(img, (0, 0), (img.shape[1] - 1, img.shape[0] - 1),
                      (0, 255, 255), 1)
        tiles.append(img)
        meta.append({"frame": i, "x0": x0, "y0": y0, "zoom": round(z, 3),
                     "box": [bw, bh]})
    th, tw = tiles[0].shape[:2]
    canvas = np.zeros((rows * th, cols * tw, 3), np.uint8)
    for k, t in enumerate(tiles):
        r, c = divmod(k, cols)
        canvas[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = t
    p = os.path.join(outdir, f"{tag}_strip_f{idxs[0]}_{idxs[-1]}.png")
    cv2.imwrite(p, canvas)
    with open(p.replace(".png", ".json"), "w") as f:
        json.dump({"tiles": meta}, f, indent=1)
    return [p]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--mode", choices=["full", "quad", "strip"], default="strip")
    ap.add_argument("--start", type=int, required=True, help="start frame index")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--step", type=int, default=1, help="frame stride")
    ap.add_argument("--center", default=None, help="cx,cy (strip)")
    ap.add_argument("--centers", default=None, help="cx,cy;cx,cy;... (strip)")
    ap.add_argument("--box", default="200,150", help="crop w,h (strip)")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--zoom", type=float, default=None)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--tag", default="v")
    a = ap.parse_args()

    os.makedirs(a.outdir, exist_ok=True)
    span = (a.n - 1) * a.step + 1
    raw = read_frames(a.video, a.start, span)
    frames = {i: raw[i] for i in sorted(raw) if (i - a.start) % a.step == 0}

    if a.mode == "full":
        paths = mode_full(frames, a.outdir, a.tag, a.zoom)
    elif a.mode == "quad":
        paths = mode_quad(frames, a.outdir, a.tag, a.cols, a.rows)
    else:
        if a.centers:
            centers = [tuple(float(v) for v in p.split(","))
                       for p in a.centers.split(";")]
        elif a.center:
            centers = [tuple(float(v) for v in a.center.split(","))]
        else:
            raise SystemExit("strip needs --center or --centers")
        box = tuple(int(v) for v in a.box.split(","))
        paths = mode_strip(frames, a.outdir, a.tag, centers, box, a.cols)

    for p in paths:
        print(p)


if __name__ == "__main__":
    main()
