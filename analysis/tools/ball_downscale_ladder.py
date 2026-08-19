#!/usr/bin/env python3
"""Does the ball survive the input resolution a learned detector would use?

TrackNet-family models resize to a fixed small input (TrackNetV2 uses 512x288).
Our ball is 2-3 px at 854x480, so at 512x288 it is between one and two pixels --
possibly below the point where any network, however well trained, has something
to convolve. That is a property of the DATA, testable without training anything,
and it decides whether buying/【fine-tuning a learned detector is even coherent.

Measured on all 13 segments: does the differencing generator still surface the
ball at each input size? The generator is not TrackNet, but it is a lower bound
on "is there a local signal here at all" -- if the ball stops producing any
separable local evidence, a heatmap regressor has nothing to latch onto either.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_hires_compare import Stack, candidates  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LADDER = [("854x480 (native)", 854, 480), ("640x360", 640, 360),
          ("512x288 (TrackNetV2 input)", 512, 288), ("427x240", 427, 240)]
TOL = 8.0
DTHRS = (5, 6, 8, 12, 16)


def main():
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    out = {}
    print("=" * 78)
    print("DETECTOR RESOLUTION LADDER -- all 13 segments, 59 labelled positions")
    print("=" * 78)
    print(f"{'input size':>28} {'ball in cand set':>18} {'cand/frame':>12} "
          f"{'med rank':>9}")
    for name, W, H in LADDER:
        sx, sy = 854.0 / W, 480.0 / H
        best = None
        for dthr in DTHRS:
            inset = pos = 0
            ranks, ncand = [], []
            for m in labels["segments"]:
                cap = cv2.VideoCapture(os.path.join(REPO, "samples",
                                                    m["clip"] + ".mp4"))
                lo = m["startFrame"] - 2
                cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
                gs = []
                for _ in range(len(m["frames"]) + 4):
                    ok, fr = cap.read()
                    if not ok:
                        break
                    g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
                    if (W, H) != (854, 480):
                        g = cv2.resize(g, (W, H), interpolation=cv2.INTER_AREA)
                    gs.append(g)
                cap.release()
                if len(gs) < 5:
                    continue
                st = Stack(gs, list(range(lo, lo + len(gs))), sx, sy)
                for fl in m["frames"]:
                    j = fl["f"] - lo
                    if not (1 <= j < len(st.gray) - 1):
                        continue
                    cs = candidates(st, j, 1.0, dthr)
                    ncand.append(len(cs))
                    if fl["s"] != "visible":
                        continue
                    pos += 1
                    dd = [np.hypot(c["x"] - fl["x"], c["y"] - fl["y"]) for c in cs]
                    rk = next((i + 1 for i, v in enumerate(dd) if v <= TOL), None)
                    if rk:
                        inset += 1
                        ranks.append(rk)
            rec = dict(dthr=dthr, inset=inset, pos=pos,
                       ncand=float(np.mean(ncand)) if ncand else 0.0,
                       medrank=float(np.median(ranks)) if ranks else None)
            if best is None or (rec["inset"], -rec["ncand"]) > (best["inset"], -best["ncand"]):
                best = rec
        out[name] = best
        mr = f"{best['medrank']:.0f}" if best["medrank"] else "-"
        print(f"{name:>28} {best['inset']:>8d}/{best['pos']:<8d} "
              f"{best['ncand']:>12.0f} {mr:>9}")

    json.dump(out, open(os.path.join(REPO, "eval/ball_detector_ladder.json"), "w"),
              default=float)
    print("\neach row is at its own best residual threshold "
          f"(swept over {list(DTHRS)})")
    print("wrote eval/ball_detector_ladder.json")


if __name__ == "__main__":
    main()
