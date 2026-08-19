#!/usr/bin/env python3
"""Which features actually separate the ball from 37k clutter blobs?

Also checks whether the streak matched filter failed because streakiness is
useless or because my ranker used it badly -- those have different remedies.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_eval import (REPO, FEATS, load, featmat, survives,  # noqa: E402
                       DEFAULT_FILT, fit_logistic)


def auc(pos, neg):
    """Probability a random ball outranks a random clutter blob."""
    allv = np.concatenate([pos, neg])
    r = np.argsort(np.argsort(allv)) + 1
    rp = r[: len(pos)].sum()
    return (rp - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def main():
    labels, rows, lab, by_frame, align = load(
        os.path.join(REPO, "eval/ball_labels_v1.json"),
        os.path.join(REPO, "eval/ball_cand_features.json"))
    X = featmat(rows)
    y = np.array([r["isball"] for r in rows], float)
    keep = np.array([survives(r, DEFAULT_FILT) for r in rows])

    print("=" * 74)
    print("SINGLE-FEATURE SEPARATION (AUC: 0.5 = useless, 1.0 = perfect)")
    print("=" * 74)
    print(f"candidates after the hand filters: {keep.sum()}   "
          f"of which ball-matching: {int(y[keep].sum())}")
    print(f"{'feature':>14} {'AUC':>6} {'ball median':>12} {'clutter median':>14}")
    Xk, yk = X[keep], y[keep]
    order = []
    for i, f in enumerate(FEATS):
        a = auc(Xk[yk == 1, i], Xk[yk == 0, i])
        order.append((max(a, 1 - a), f, a))
        print(f"{f:>14} {a:6.3f} {np.median(Xk[yk==1,i]):12.1f} "
              f"{np.median(Xk[yk==0,i]):14.1f}")
    print("\nranked by |AUC-0.5| (direction-agnostic discriminative power):")
    for s, f, a in sorted(order, reverse=True):
        print(f"   {f:>14} {a:.3f}")

    print()
    print("=" * 74)
    print("LEARNED LINEAR WEIGHTS (standardised; fitted on all data, for reading)")
    print("=" * 74)
    w, mu, sd = fit_logistic(Xk, yk)
    for f, wi in sorted(zip(FEATS, w[:-1]), key=lambda t: -abs(t[1])):
        print(f"   {f:>14} {wi:+7.3f}")
    print(f"   {'(bias)':>14} {w[-1]:+7.3f}")

    print()
    print("=" * 74)
    print("STREAK DIAGNOSIS -- is streakiness real signal used badly?")
    print("=" * 74)
    print(f"   raw streak AUC          {auc(Xk[yk==1, FEATS.index('streak')], Xk[yk==0, FEATS.index('streak')]):.3f}")
    st = Xk[:, FEATS.index("streak")]
    dm = Xk[:, FEATS.index("dmax")]
    ratio = st / np.maximum(dm, 1e-6)
    print(f"   streak/dmax AUC         {auc(ratio[yk==1], ratio[yk==0]):.3f}"
          "   <- concentration of the residual along a line, size-normalised")
    el = Xk[:, FEATS.index("elong")]
    print(f"   elong AUC               {auc(el[yk==1], el[yk==0]):.3f}")
    print(f"   ball elong median       {np.median(el[yk==1]):.2f}")
    print(f"   clutter elong median    {np.median(el[yk==0]):.2f}")

    print()
    print("labelled 'look' field vs measured elongation (does blur show up?):")
    lk = {}
    for r, isb in zip(rows, y):
        if not isb:
            continue
        fl = lab.get((r["seg"], r["f"]))
        if fl and fl.get("look"):
            lk.setdefault(fl["look"], []).append(r["elong"])
    for k, v in sorted(lk.items()):
        print(f"   {k:>8}: n={len(v):3d}  median elong={np.median(v):.2f}")


if __name__ == "__main__":
    main()
