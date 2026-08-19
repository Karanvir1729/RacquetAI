#!/usr/bin/env python3
"""Parameter sweep + recall@k diagnostics for the ball detectors.

recall@k answers the question that decides whether the phase is salvageable:
is the ball ANYWHERE in the candidate set (a ranking problem, which trajectory
consistency can fix) or absent from it (a generator problem, which it cannot)?
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_detect import REPO, load_segments, run_detector, score  # noqa: E402


def recall_at_k(rows, ks=(1, 3, 5, 10, 25, 50), tol=8.0):
    pos = [r for r in rows if r["label"]["s"] == "visible"]
    out = {}
    for k in ks:
        h = 0
        for r in pos:
            lab = r["label"]
            for c in r["cands"][:k]:
                if np.hypot(c["x"] - lab["x"], c["y"] - lab["y"]) <= tol:
                    h += 1
                    break
        out[k] = (h, len(pos))
    return out


def per_segment_recall(rows, k=50, tol=8.0):
    agg = {}
    for r in rows:
        if r["label"]["s"] != "visible":
            continue
        a = agg.setdefault(r["seg"], [0, 0])
        a[1] += 1
        lab = r["label"]
        for c in r["cands"][:k]:
            if np.hypot(c["x"] - lab["x"], c["y"] - lab["y"]) <= tol:
                a[0] += 1
                break
    return agg


def main():
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    segs = load_segments(labels)

    print("=" * 78)
    print("SWEEP 1 -- candidate generator: is the ball in the candidate set?")
    print("=" * 78)
    best = None
    for erode_r in (0, 1, 2):
        for dthr in (8, 12, 18, 25, 35):
            p = dict(erode_r=erode_r, dthr=dthr, amin=2, amax=200,
                     maxext=30, vmax=170, topn=200)
            rows = run_detector(segs, p)
            rk = recall_at_k(rows, ks=(1, 5, 50, 200))
            s1 = score(rows, topk=1)
            print(f"erode={erode_r} dthr={dthr:2d}  r@1={rk[1][0]:2d}/{rk[1][1]}"
                  f"  r@5={rk[5][0]:2d}  r@50={rk[50][0]:2d}"
                  f"  r@200={rk[200][0]:2d}  fp/frame(top1)={s1['fp_per_frame']:.2f}")
            if best is None or rk[200][0] > best[1]:
                best = (p, rk[200][0])
    print("\nbest generator recall@200:", best[1], "with", best[0])

    print()
    print("=" * 78)
    print("SWEEP 2 -- area/extent limits at the best threshold")
    print("=" * 78)
    base = dict(best[0])
    for amax, maxext in ((40, 12), (120, 22), (200, 30), (400, 45), (900, 70)):
        p = dict(base, amax=amax, maxext=maxext, topn=200)
        rows = run_detector(segs, p)
        rk = recall_at_k(rows, ks=(1, 5, 50, 200))
        print(f"amax={amax:3d} maxext={maxext:2d}  r@1={rk[1][0]:2d} "
              f"r@5={rk[5][0]:2d} r@50={rk[50][0]:2d} r@200={rk[200][0]:2d}")

    print()
    print("=" * 78)
    print("SWEEP 3 -- darkness ceiling (the ball is black)")
    print("=" * 78)
    for vmax in (100, 130, 150, 170, 200, 255):
        p = dict(base, vmax=vmax, amax=400, maxext=45, topn=200)
        rows = run_detector(segs, p)
        rk = recall_at_k(rows, ks=(1, 5, 50, 200))
        print(f"vmax={vmax:3d}  r@1={rk[1][0]:2d} r@5={rk[5][0]:2d} "
              f"r@50={rk[50][0]:2d} r@200={rk[200][0]:2d}")

    print()
    print("=" * 78)
    print("PER-SEGMENT generator recall@200 at the loosest setting")
    print("=" * 78)
    p = dict(base, vmax=255, amax=900, maxext=70, topn=200)
    rows = run_detector(segs, p)
    for k, (h, n) in sorted(per_segment_recall(rows, k=200).items()):
        print(f"{k:22s} {h:2d}/{n}")


if __name__ == "__main__":
    main()
