#!/usr/bin/env python3
"""Where does the true ball sit in the candidate ranking, and what outranks it?

If the ball is usually rank 2-10 the trajectory stage needs a shallow candidate
list and will be fast and clean. If it is usually rank 100+ the clutter
population is so large that any triplet search will drown in spurious matches.
"""
import json
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_detect import REPO, load_segments, run_detector  # noqa: E402

P = dict(erode_r=1, dthr=8, amin=2, amax=120, maxext=22, vmax=170, topn=400)


def main():
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    segs = load_segments(labels)
    rows = run_detector(segs, P)

    ranks, ncands, missed = [], [], []
    for r in rows:
        ncands.append(len(r["cands"]))
        if r["label"]["s"] != "visible":
            continue
        lab = r["label"]
        rk = None
        for i, c in enumerate(r["cands"]):
            if np.hypot(c["x"] - lab["x"], c["y"] - lab["y"]) <= 8.0:
                rk = i + 1
                break
        if rk is None:
            missed.append((r["seg"], r["f"], lab.get("look"), lab.get("bg")))
        else:
            ranks.append(rk)

    ranks = np.array(ranks)
    print(f"labelled-visible frames with the ball in the list: {len(ranks)}/59")
    print(f"rank of the true ball: median={np.median(ranks):.0f} "
          f"p25={np.percentile(ranks,25):.0f} p75={np.percentile(ranks,75):.0f} "
          f"p90={np.percentile(ranks,90):.0f} max={ranks.max()}")
    print("rank histogram:", Counter(np.digitize(ranks, [2, 4, 6, 11, 21, 51, 101])))
    print("  bins: 1 | 2-3 | 4-5 | 6-10 | 11-20 | 21-50 | 51-100 | 101+")
    print()
    nc = np.array(ncands)
    print(f"candidates per frame: median={np.median(nc):.0f} "
          f"mean={nc.mean():.1f} p90={np.percentile(nc,90):.0f} max={nc.max()}")
    print()
    print("frames where the generator NEVER produced the ball:")
    for m in missed:
        print("   ", m)


if __name__ == "__main__":
    main()
