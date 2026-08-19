#!/usr/bin/env python3
"""Is the detector's recall real, or is an 8 px disc just easy to hit by chance?

The ball is 2-3 px and the scoring tolerance is 8 px, so a candidate that has
nothing to do with the ball still scores a hit if it lands within 8 px. With
~150 candidates per frame clustered exactly where the motion is -- which is
also where the ball is -- that is not a negligible worry, and it cannot be
argued away analytically. So it is measured two ways:

  PERMUTATION NULL   score the detector against labels taken from a DIFFERENT
                     frame of the same segment. The ball's true position is
                     destroyed but the label's spatial distribution, the
                     segment's clutter, and the detector are all unchanged.
                     Whatever recall survives is chance.

  TOLERANCE SWEEP    recall at 3, 5, 8, 12 px. A real detection sits within a
                     couple of px (the labeller's own read error is +/-2). If
                     recall only appears once the disc is wide, the "hits" are
                     coincidences with nearby movers.
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_eval import (REPO, load, featmat, survives, COMPACT_FILT,  # noqa: E402
                       fit_logistic, apply_logistic)
from ball_experiments import trajectory_scores  # noqa: E402


def build_emissions():
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
    tp = dict(spans=(1, 2), vmin=0.5, vmax=140.0, accel_tol=3.0)
    tr = trajectory_scores(rows, align, base, COMPACT_FILT, tp)
    emit = {}
    for k in lab:
        cs = tr.get(k, [])
        if cs:
            i = int(np.argmax([c["tscore"] for c in cs]))
            emit[k] = (cs[i]["tscore"], cs[i]["x"], cs[i]["y"])
        else:
            emit[k] = None
    return labels, lab, emit


def recall_fp(lab, emit, thr, tol, label_xy):
    tp = fp = npos = 0
    for k, fl in lab.items():
        if fl["s"] == "visible":
            npos += 1
        e = emit.get(k)
        if e is None or e[0] < thr:
            continue
        gt = label_xy.get(k)
        if gt is not None and np.hypot(e[1] - gt[0], e[2] - gt[1]) <= tol:
            tp += 1
        else:
            fp += 1
    return tp, fp, npos


def main():
    labels, lab, emit = build_emissions()
    true_xy = {k: (v["x"], v["y"]) for k, v in lab.items() if v["s"] == "visible"}

    # operating threshold: tightest FP budget used in the report
    thrs = sorted({e[0] for e in emit.values() if e})
    thr = None
    for t in thrs:
        _, fp, _ = recall_fp(lab, emit, t, 8.0, true_xy)
        if fp / len(lab) <= 0.05:
            thr = t
            break
    print(f"operating threshold {thr:.3f}  (FP/frame <= 0.05, tol 8 px)\n")

    print("=" * 70)
    print("TOLERANCE SWEEP at that operating point")
    print("=" * 70)
    print(f"{'tol px':>7} {'recall':>12} {'as %':>7}")
    for tol in (2, 3, 5, 8, 12, 20):
        tp, fp, npos = recall_fp(lab, emit, thr, tol, true_xy)
        print(f"{tol:>7} {tp:>5d}/{npos:<5d} {100*tp/npos:6.1f}%")

    print()
    print("=" * 70)
    print("PERMUTATION NULL -- labels shuffled WITHIN each segment, 2000 draws")
    print("=" * 70)
    byseg = defaultdict(list)
    for k, v in lab.items():
        if v["s"] == "visible":
            byseg[k[0]].append(k)
    rng = np.random.default_rng(20260818)
    for tol in (5, 8, 12):
        obs_tp, _, npos = recall_fp(lab, emit, thr, tol, true_xy)
        null = []
        for _ in range(2000):
            shuf = {}
            for s, keys in byseg.items():
                perm = rng.permutation(len(keys))
                for a, b in zip(keys, [keys[i] for i in perm]):
                    shuf[a] = (lab[b]["x"], lab[b]["y"])
            tp, _, _ = recall_fp(lab, emit, thr, tol, shuf)
            null.append(tp)
        null = np.array(null)
        p = (null >= obs_tp).mean()
        print(f"tol={tol:>2}px  observed {obs_tp:2d}/{npos}   "
              f"null mean {null.mean():5.2f}  null p95 {np.percentile(null,95):5.1f}"
              f"   p={p:.4f}")

    print()
    print("=" * 70)
    print("PER-SEGMENT breakdown at tol 8 px (where does recall come from?)")
    print("=" * 70)
    for s in sorted(byseg):
        keys = byseg[s]
        tp = 0
        for k in keys:
            e = emit.get(k)
            if e and e[0] >= thr and np.hypot(
                    e[1] - lab[k]["x"], e[2] - lab[k]["y"]) <= 8.0:
                tp += 1
        errs = []
        for k in keys:
            e = emit.get(k)
            if e and e[0] >= thr:
                errs.append(np.hypot(e[1] - lab[k]["x"], e[2] - lab[k]["y"]))
        em = f"{np.median(errs):.1f}" if errs else "-"
        print(f"   {s:22s} {tp:2d}/{len(keys):<3d}  median err {em:>5} px")


if __name__ == "__main__":
    main()
