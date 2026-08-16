#!/usr/bin/env python3
"""Scan a video for camera motion using phase correlation on the upper-wall strip.

Players never enter the top ~22% of these clips (ceiling/upper front wall), so
translational shift there approximates camera motion. Prints per-second drift and
the longest window whose cumulative drift stays under a threshold.
"""
import argparse
import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--strip", type=float, default=0.22, help="top fraction of frame to use")
    ap.add_argument("--step", type=float, default=1.0, help="seconds between samples")
    ap.add_argument("--drift-px", type=float, default=6.0, help="max cumulative drift within a window")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    dur = n / fps
    times = np.arange(0, dur, args.step)

    prev = None
    shifts = []  # (t, dx, dy)
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            break
        h = frame.shape[0]
        strip = cv2.cvtColor(frame[: int(h * args.strip)], cv2.COLOR_BGR2GRAY).astype(np.float32)
        strip = cv2.GaussianBlur(strip, (5, 5), 0)
        if prev is not None:
            (dx, dy), _ = cv2.phaseCorrelate(prev, strip)
            shifts.append((t, dx, dy))
        prev = strip
    cap.release()

    # cumulative position over time
    xs = np.cumsum([s[1] for s in shifts])
    ys = np.cumsum([s[2] for s in shifts])
    ts = [s[0] for s in shifts]

    # longest window where max pairwise displacement < drift-px
    best = (0, 0, 0)  # (len, i, j)
    i = 0
    for j in range(len(ts)):
        while True:
            wx = xs[i : j + 1]
            wy = ys[i : j + 1]
            d = max(wx.max() - wx.min(), wy.max() - wy.min())
            if d <= args.drift_px or i == j:
                break
            i += 1
        if ts[j] - ts[i] > best[0]:
            best = (ts[j] - ts[i], ts[i], ts[j])

    print(f"duration={dur:.1f}s samples={len(ts)}")
    print("per-10s cumulative drift (px):")
    for k in range(0, len(ts), 10):
        print(f"  t={ts[k]:6.1f}  x={xs[k]:7.1f}  y={ys[k]:7.1f}")
    print(f"LONGEST_STABLE_WINDOW start={best[1]:.1f} end={best[2]:.1f} len={best[0]:.1f}s (drift<={args.drift_px}px)")


if __name__ == "__main__":
    main()
