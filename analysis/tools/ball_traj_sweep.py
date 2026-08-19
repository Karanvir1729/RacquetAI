#!/usr/bin/env python3
"""Does trajectory consistency convert a good candidate SET into a good pick?"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_detect import REPO, load_segments, run_detector, score  # noqa: E402

GEN = dict(erode_r=1, dthr=8, amin=2, amax=120, maxext=22, vmax=170)


def main():
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    segs = load_segments(labels)

    print("baseline, no trajectory stage (top-1 of the raw ranking)")
    for topn in (12,):
        p = dict(GEN, topn=topn)
        s = score(run_detector(segs, p), topk=1)
        print(f"  topn={topn}  recall={s['hits']}/{s['positives']}  "
              f"fp/frame={s['fp_per_frame']:.2f}  "
              f"null fp/frame={s['null_fp_per_frame']:.2f}  "
              f"loc_med={s['loc_med']}")

    print()
    print("with trajectory consistency (top-1 of the trajectory ranking)")
    print(f"{'accel':>6} {'vmin':>5} {'vmax':>5} {'topn':>5} | "
          f"{'recall':>9} {'fp/fr':>6} {'nullfp':>7} {'locmed':>7}")
    best = None
    for accel_tol in (2.0, 3.0, 5.0, 8.0):
        for vmin in (0.5, 1.5, 3.0):
            for vmax_traj in (40.0, 80.0, 140.0):
                p = dict(GEN, topn=12, accel_tol=accel_tol, vmin=vmin,
                         vmax_traj=vmax_traj, topn_traj=5, spans=(1, 2))
                rows = run_detector(segs, p, use_traj=True)
                s = score(rows, topk=1)
                lm = f"{s['loc_med']:.1f}" if s["loc_med"] is not None else "-"
                print(f"{accel_tol:6.1f} {vmin:5.1f} {vmax_traj:5.0f} {12:5d} | "
                      f"{s['hits']:4d}/{s['positives']:<4d} "
                      f"{s['fp_per_frame']:6.2f} {s['null_fp_per_frame']:7.2f} "
                      f"{lm:>7}")
                # rank settings by recall at a false-positive budget
                if s["fp_per_frame"] <= 0.35:
                    if best is None or s["hits"] > best[1]:
                        best = (p, s["hits"], s)
    if best:
        print("\nbest at fp/frame <= 0.35:", {k: v for k, v in best[0].items()
                                              if k in ("accel_tol", "vmin", "vmax_traj")})
        print("   recall", best[1], "/", best[2]["positives"],
              " fp/frame", round(best[2]["fp_per_frame"], 3))


if __name__ == "__main__":
    main()
