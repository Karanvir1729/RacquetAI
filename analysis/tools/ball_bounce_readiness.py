#!/usr/bin/env python3
"""Could the events the product needs be built on this detector?

Recall per frame is the wrong statistic for bounce detection. A bounce is found
by fitting motion BEFORE and AFTER an instant and finding the discontinuity, so
what matters is whether detections arrive in usable consecutive RUNS, and
whether they survive at the moment of the bounce itself.

There is a structural tension worth measuring rather than assuming: the best
detector here keeps candidates that lie on a CONSTANT-VELOCITY triplet, and a
bounce is exactly where constant velocity fails. If the trajectory stage is
what makes precision acceptable, it may also be blinding the detector at
precisely the frames the referee needs.
"""
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_eval import (REPO, load, featmat, survives, COMPACT_FILT,  # noqa: E402
                       fit_logistic, apply_logistic)
from ball_experiments import trajectory_scores  # noqa: E402


def emissions(use_traj):
    labels, rows, lab, by_frame, align = load(
        os.path.join(REPO, "eval/ball_labels_v1.json"),
        os.path.join(REPO, "eval/ball_cand_features.json"))
    X = featmat(rows)
    y = np.array([r["isball"] for r in rows], float)
    segs = np.array([r["seg"] for r in rows])
    keep = np.array([survives(r, COMPACT_FILT) for r in rows])
    loso = np.full(len(rows), -1e9)
    for s in sorted(set(segs)):
        tr, te = keep & (segs != s), keep & (segs == s)
        if tr.sum() < 50 or te.sum() == 0 or y[tr].sum() < 3:
            continue
        loso[te] = apply_logistic(fit_logistic(X[tr], y[tr]), X[te])
    idx = {id(r): i for i, r in enumerate(rows)}
    base = lambda cs: np.array([loso[idx[id(c)]] for c in cs])  # noqa: E731
    if use_traj:
        tp = dict(spans=(1, 2), vmin=0.5, vmax=140.0, accel_tol=3.0)
        traj = trajectory_scores(rows, align, base, COMPACT_FILT, tp)
        pick = {k: (max(v, key=lambda c: c["tscore"]) if v else None)
                for k, v in traj.items()}
        sc = {k: (c["tscore"] if c else None) for k, c in pick.items()}
    else:
        pick, sc = {}, {}
        for k, cs in by_frame.items():
            ok = [c for c in cs if survives(c, COMPACT_FILT)]
            if not ok:
                pick[k], sc[k] = None, None
                continue
            v = base(ok)
            i = int(np.argmax(v))
            pick[k], sc[k] = ok[i], float(v[i])
    thrs = sorted({v for v in sc.values() if v is not None})
    thr = None
    for t in thrs:
        fp = 0
        for k in lab:
            c, s = pick.get(k), sc.get(k)
            if c is None or s is None or s < t:
                continue
            fl = lab[k]
            if not (fl["s"] == "visible"
                    and np.hypot(c["x"] - fl["x"], c["y"] - fl["y"]) <= 8.0):
                fp += 1
        if fp / len(lab) <= 0.05:
            thr = t
            break
    thr = thr if thr is not None else (max(thrs) + 1 if thrs else 1e9)
    hits = set()
    for k in lab:
        c, s = pick.get(k), sc.get(k)
        fl = lab[k]
        if c is not None and s is not None and s >= thr and fl["s"] == "visible" \
                and np.hypot(c["x"] - fl["x"], c["y"] - fl["y"]) <= 8.0:
            hits.add(k)
    return labels, lab, hits


def runs_of(labels, hits):
    out = []
    for m in labels["segments"]:
        cur = 0
        for fl in m["frames"]:
            if (m["seg"], fl["f"]) in hits:
                cur += 1
            else:
                if cur:
                    out.append(cur)
                cur = 0
        if cur:
            out.append(cur)
    return out


def main():
    print("=" * 74)
    print("BOUNCE READINESS -- are detections arriving in usable runs?")
    print("=" * 74)
    for use_traj, name in ((True, "with trajectory stage"), (False, "ranker only")):
        labels, lab, hits = emissions(use_traj)
        r = runs_of(labels, hits)
        c = Counter(r)
        print(f"\n{name}: {len(hits)} detections in {len(r)} runs")
        print("   run length -> count:", dict(sorted(c.items())))
        print(f"   longest run {max(r) if r else 0} frames "
              f"({(max(r) if r else 0)/29.97*1000:.0f} ms)")
        usable = sum(1 for x in r if x >= 3)
        print(f"   runs of >=3 consecutive frames (minimum to fit a velocity): "
              f"{usable}")
        print(f"   runs of >=6 (enough to fit motion either side of a bounce): "
              f"{sum(1 for x in r if x >= 6)}")

    print()
    print("=" * 74)
    print("A squash rally ends on the SECOND floor bounce. To referee, the")
    print("detector must catch a specific instant, near the floor, usually with")
    print("a player between the ball and the lens. Below is where the ball was")
    print("actually visible to the human at all, by background:")
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    bg = Counter()
    for m in labels["segments"]:
        for fl in m["frames"]:
            if fl["s"] == "visible":
                bg[fl.get("bg", "?")] += 1
    for k, v in bg.most_common():
        print(f"   {k:>12}: {v}")
    print("\nFloor-background frames are the ones a bounce detector lives on.")


if __name__ == "__main__":
    main()
