#!/usr/bin/env python3
"""Same frames, same ball, two resolutions: what does resolution actually buy?

The 854x480 analysis clips are downscales of 1920x1080 QuickTime originals held
in the same archive item (identical duration and 30000/1001 timebase, so frame
indices line up exactly). This measures the ball at hand-labelled positions in
BOTH, so the resolution question is answered on the same physical ball in the
same lighting rather than by comparing two different shoots.

Three numbers per frame, at each resolution:
  contrast  how many grey levels darker than the local background the ball's
            darkest pixel is
  extent    how many pixels are meaningfully darker: the ball's footprint
  control   the same statistic on ball-free patches nearby, which is the
            clutter floor a detector has to clear

Frames are matched to the low-res timeline by picture content, not by trusting
timestamps, and the low-res label is snapped within a small window at high res
because a 2.25x scale-up of a hand-read coordinate is itself several pixels out.

    .venv/bin/python tools/ball_resolution_compare.py \
        --hr-dir /tmp/ball/hr --clip archive_match4 --seg archive_match4#2
"""
import argparse
import glob
import json
import os
import random

import cv2
import numpy as np


def stats(im, x, y, ring_r, core_r):
    """(contrast, extent) at (x,y) with windows scaled to the resolution."""
    H, W = im.shape
    if not (ring_r <= x < W - ring_r and ring_r <= y < H - ring_r):
        return None
    win = im[y - ring_r:y + ring_r + 1, x - ring_r:x + ring_r + 1].astype(np.int16)
    core = im[y - core_r:y + core_r + 1, x - core_r:x + core_r + 1].astype(np.int16)
    ring = np.concatenate([win[0, :], win[-1, :], win[:, 0], win[:, -1]])
    bg = float(np.median(ring))
    contrast = bg - float(core.min())
    extent = int((win < bg - max(8.0, contrast * 0.5)).sum())
    return contrast, extent, bg


def snap(im, x, y, rad, ring_r):
    best = None
    H, W = im.shape
    for dy in range(-rad, rad + 1):
        for dx in range(-rad, rad + 1):
            cx, cy = x + dx, y + dy
            if not (ring_r <= cx < W - ring_r and ring_r <= cy < H - ring_r):
                continue
            win = im[cy - ring_r:cy + ring_r + 1,
                     cx - ring_r:cx + ring_r + 1].astype(np.int16)
            ring = np.concatenate([win[0, :], win[-1, :], win[:, 0], win[:, -1]])
            sc = float(np.median(ring)) - float(im[cy, cx])
            if best is None or sc > best[0]:
                best = (sc, cx, cy)
    return best


def control(im, x, y, ring_r, core_r, lo, hi, seed):
    rs = random.Random(seed)
    out = []
    H, W = im.shape
    for _ in range(16):
        a = rs.uniform(0, 6.283)
        r = rs.uniform(lo, hi)
        cx, cy = int(x + r * np.cos(a)), int(y + r * np.sin(a))
        s = stats(im, cx, cy, ring_r, core_r)
        if s:
            out.append(s[0])
    return out


def align(hr_paths, cap, lo_lo, lo_hi):
    """Map each high-res PNG to a low-res frame index by picture content."""
    frames = {}
    cap.set(cv2.CAP_PROP_POS_FRAMES, lo_lo)
    for i in range(lo_lo, lo_hi):
        ok, fr = cap.read()
        if not ok:
            break
        frames[i] = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    out = {}
    for p in hr_paths:
        g = cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2GRAY)
        s = cv2.resize(g, (854, 480), interpolation=cv2.INTER_AREA).astype(np.float32)
        k, _ = min(frames.items(), key=lambda kv: float(np.abs(kv[1] - s).mean()))
        out[k] = p
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hr-dir", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--seg", required=True)
    ap.add_argument("--labels", default="eval/ball_labels_v1.json")
    ap.add_argument("--videos", default="samples")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    doc = json.load(open(a.labels))
    seg = next(g for g in doc["segments"] if g["seg"] == a.seg)
    f0 = seg["startFrame"]
    cap = cv2.VideoCapture(f"{a.videos}/{a.clip}.mp4")
    hr = align(sorted(glob.glob(os.path.join(a.hr_dir, "*.png"))), cap,
               max(0, f0 - 8), f0 + len(seg["frames"]) + 8)

    rows = []
    for f in seg["frames"]:
        idx = f["f"]
        if idx not in hr:
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, fr = cap.read()
        if not ok:
            continue
        lo = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        himg = cv2.cvtColor(cv2.imread(hr[idx]), cv2.COLOR_BGR2GRAY)
        sy, sx = himg.shape[0] / lo.shape[0], himg.shape[1] / lo.shape[1]
        row = {"frame": idx, "state": f["s"], "look": f.get("look"),
               "miss": f.get("miss")}
        if f["s"] == "visible":
            ls = stats(lo, int(f["x"]), int(f["y"]), 9, 3)
            hx, hy = int(f["x"] * sx), int(f["y"] * sy)
            b = snap(himg, hx, hy, 12, 20)
            if ls and b:
                hs = stats(himg, b[1], b[2], 20, 7)
                row.update({
                    "lo_contrast": round(ls[0], 1), "lo_extent": ls[1],
                    "hi_contrast": round(hs[0], 1), "hi_extent": hs[1],
                    "lo_ctrl_max": round(max(control(lo, int(f["x"]), int(f["y"]),
                                                     9, 3, 25, 45, idx)), 1),
                    "hi_ctrl_max": round(max(control(himg, b[1], b[2],
                                                     20, 7, 56, 101, idx)), 1)})
        else:
            # For a frame the eye could not resolve at 854x480 there is no
            # labelled position, so report the best local dark spot at high res
            # in the neighbourhood the trajectory implies, for eyeballing.
            row["note"] = "no low-res label; inspect the high-res crop by eye"
        rows.append(row)

    vis = [r for r in rows if "lo_contrast" in r]
    if vis:
        lc = np.array([r["lo_contrast"] for r in vis])
        hc = np.array([r["hi_contrast"] for r in vis])
        le = np.array([r["lo_extent"] for r in vis])
        he = np.array([r["hi_extent"] for r in vis])
        lm = np.array([r["lo_ctrl_max"] for r in vis])
        hm = np.array([r["hi_ctrl_max"] for r in vis])
        print(f"{a.seg}: {len(vis)} frames measured at both resolutions")
        print(f"  contrast   854x480 median {np.median(lc):5.1f}   "
              f"1920x1080 median {np.median(hc):5.1f}")
        print(f"  extent px  854x480 median {np.median(le):5.1f}   "
              f"1920x1080 median {np.median(he):5.1f}  "
              f"(x{np.median(he) / max(np.median(le), 1):.1f} area, "
              f"5.06x expected from pixel count alone)")
        print(f"  worst nearby clutter patch: 854x480 median {np.median(lm):5.1f}"
              f"   1920x1080 median {np.median(hm):5.1f}")
        beats_lo = sum(1 for r in vis if r["lo_contrast"] > r["lo_ctrl_max"])
        beats_hi = sum(1 for r in vis if r["hi_contrast"] > r["hi_ctrl_max"])
        print(f"  ball darker than all nearby clutter: "
              f"854x480 {beats_lo}/{len(vis)}   1920x1080 {beats_hi}/{len(vis)}")
    for r in rows:
        if "lo_contrast" in r:
            print(f"   f{r['frame']} {str(r['look']):7s} "
                  f"contrast {r['lo_contrast']:6.1f} -> {r['hi_contrast']:6.1f}   "
                  f"extent {r['lo_extent']:4d} -> {r['hi_extent']:4d}")
        else:
            print(f"   f{r['frame']} NOT VISIBLE at 854x480 ({r['miss']})")
    if a.out:
        json.dump({"seg": a.seg, "rows": rows}, open(a.out, "w"), indent=1)
        print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
