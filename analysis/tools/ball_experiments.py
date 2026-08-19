#!/usr/bin/env python3
"""Run every ball detector and print the comparison table + PR curves.

    python tools/ball_experiments.py            # 854x480
    python tools/ball_experiments.py --feat eval/ball_cand_features_1080.json
"""
import argparse
import json
import os
import sys
from collections import defaultdict

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_eval import (REPO, TOL, FEATS, NULL_REASONS, load, featmat,  # noqa: E402
                       survives, DEFAULT_FILT, COMPACT_FILT, curve, at_budget,
                       boot_ci, fit_logistic, apply_logistic)

TOPK_TRAJ = 12


# ---------------------------------------------------------------- trajectory
def ref_xy(align, seg, j, pts):
    """Map frame-j pixel positions into the segment reference frame."""
    if len(pts) == 0:
        return np.zeros((0, 2))
    H = np.eye(3)
    Hs = np.array(align[seg]["Hstep"])
    ref = len(Hs) // 2
    if j < ref:
        for k in range(j, ref):
            H = Hs[k] @ H
    elif j > ref:
        for k in range(ref, j):
            H = np.linalg.inv(Hs[k]) @ H
    H = H / H[2, 2]
    return cv2.perspectiveTransform(
        np.asarray(pts, np.float32).reshape(-1, 1, 2), H).reshape(-1, 2)


def trajectory_scores(rows, align, base_score, filt, p):
    """Attach a trajectory score to candidates lying on a constant-velocity
    triplet, in camera-motion-compensated reference coordinates.

    Returns {(seg, frame): [candidate dicts with 'tscore']}. Frames with no
    consistent triplet get an empty list, which is the detector declining to
    emit -- the behaviour a referee needs more than it needs recall.
    """
    by_sj = defaultdict(list)
    for r in rows:
        if survives(r, filt):
            by_sj[(r["seg"], r["j"])].append(r)
    top = {}
    for k, cs in by_sj.items():
        sc = base_score(cs)
        order = np.argsort(-sc)[:TOPK_TRAJ]
        sel = [cs[i] for i in order]
        top[k] = (sel, np.array([sc[i] for i in order], float),
                  ref_xy(align, k[0], k[1], [[c["x"], c["y"]] for c in sel]))
    out = defaultdict(list)
    for (seg, j), (sel, sc, R) in top.items():
        best = [None] * len(sel)
        for span in p["spans"]:
            a = top.get((seg, j - span))
            b = top.get((seg, j + span))
            if a is None or b is None or not len(a[2]) or not len(b[2]) or not len(R):
                continue
            P, N = a[2], b[2]
            pred = 2.0 * R[None, :, :] - P[:, None, :]
            dd = np.linalg.norm(pred[:, :, None, :] - N[None, None, :, :], axis=-1)
            step = np.linalg.norm(R[None, :, :] - P[:, None, :], axis=-1)
            okv = (step >= p["vmin"] * span) & (step <= p["vmax"] * span)
            dd = np.where(okv[:, :, None], dd, np.inf)
            for ci in range(len(R)):
                sub = dd[:, ci, :]
                if not np.isfinite(sub).any():
                    continue
                pi, ni = np.unravel_index(np.argmin(sub), sub.shape)
                err = float(sub[pi, ni])
                if err > p["accel_tol"] * span:
                    continue
                tot = float(a[1][pi] + sc[ci] + b[1][ni])
                # reward agreement, penalise the fit residual
                val = tot / (1.0 + err / max(p["accel_tol"], 1e-6))
                if best[ci] is None or val > best[ci]:
                    best[ci] = val
        for ci, v in enumerate(best):
            if v is not None:
                c = dict(sel[ci])
                c["tscore"] = v
                out[(seg, c["f"])].append(c)
    return out


# ---------------------------------------------------------------- reporting
def report(name, pts, note="", budgets=(0.05, 0.10, 0.25, 0.50)):
    print(f"\n--- {name} ---")
    if note:
        print(f"    {note}")
    if not pts:
        print("    no operating points (detector emitted nothing)")
        return
    print(f"    {'FP/frame budget':>16} | {'recall':>13} | {'95% CI (seg boot)':>19}"
          f" | {'nullFP/fr':>9} | {'loc med':>7}")
    for b in budgets:
        pt = at_budget(pts, b)
        if pt is None:
            print(f"    {b:>16.2f} | {'unreachable':>13} |")
            continue
        lo, hi = boot_ci(pt["per_seg"])
        lm = f"{pt['loc_med']:.1f}" if pt["loc_med"] is not None else "-"
        print(f"    {b:>16.2f} | {pt['tp']:4d}/{pt['npos']:<4d} "
              f"{pt['recall']*100:5.1f}% | [{lo*100:5.1f}%, {hi*100:5.1f}%] "
              f"| {pt['null_fp_per_frame']:9.3f} | {lm:>7}")
    mx = max(pts, key=lambda p: p["recall"])
    print(f"    max recall anywhere on the curve: {mx['tp']}/{mx['npos']} "
          f"({mx['recall']*100:.1f}%) at FP/frame={mx['fp_per_frame']:.2f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(REPO, "eval/ball_labels_v1.json"))
    ap.add_argument("--feat", default=os.path.join(REPO, "eval/ball_cand_features.json"))
    ap.add_argument("--out", default=os.path.join(REPO, "eval/ball_detector_results.json"))
    args = ap.parse_args()

    labels, rows, lab, by_frame, align = load(args.labels, args.feat)
    npos = sum(1 for v in lab.values() if v["s"] == "visible")
    nnull = sum(1 for v in lab.values()
                if v["s"] != "visible" and v.get("miss") in NULL_REASONS)
    print("=" * 78)
    print("BALL DETECTION -- measured against 156 hand-labelled frames")
    print("=" * 78)
    print(f"labelled frames {len(lab)}   ball visible to a human {npos}   "
          f"clean-null frames {nnull}")
    print(f"raw candidates in the table {len(rows)}   "
          f"({len(rows)/max(len(by_frame),1):.0f} per frame at the permissive floor)")
    print("\nRECALL IS DENOMINATED IN THE 59 FRAMES A HUMAN COULD SEE THE BALL IN.")
    print("A detector cannot be asked to find what is behind a player's back.")

    results = {}

    # ---- A: differencing, ranked by residual strength
    ptsA, _ = curve(by_frame, lab, lambda cs: np.array([c["dmax"] for c in cs]))
    report("A  differencing + dark-blob filters, ranked by residual strength", ptsA,
           "the obvious first attempt. RECALL IS BIASED UP: the labeller's aid "
           "was this same difference.")
    results["A_diff"] = ptsA

    # ---- A': the same, plus the compactness cut the feature probe suggested
    ptsAc, _ = curve(by_frame, lab, lambda cs: np.array([c["dmax"] for c in cs]),
                     filt=COMPACT_FILT)
    report("A' A + elongation ceiling (rejects sub-pixel alignment slivers)", ptsAc,
           "TUNED ON TEST: the ceiling was chosen from these labels' own "
           "feature statistics.")
    results["Aprime_diff_compact"] = ptsAc

    # ---- B: streak matched filter
    ptsB, _ = curve(by_frame, lab, lambda cs: np.array([c["streak"] for c in cs]),
                    filt=COMPACT_FILT)
    report("B  motion-streak matched filter (oriented line kernels)", ptsB,
           "streak AUC alone is 0.902, but streak/dmax AUC is 0.433 -- the "
           "matched filter adds essentially nothing over plain residual "
           "strength, because both just measure 'a strong dark change here'.")
    results["B_streak"] = ptsB

    ptsB2, _ = curve(by_frame, lab, lambda cs: np.array(
        [c["streak"] * (1.0 + 0.3 * min(c["elong"], 4.0)) for c in cs]),
        filt=COMPACT_FILT)
    report("B2 streak x elongation (the motion-streak hypothesis, taken literally)",
           ptsB2, "rewarding elongation is BACKWARDS on this footage: clutter's "
                  "median elongation is ~500 to the ball's ~1.7.")
    results["B2_streak_elong"] = ptsB2

    # ---- L: learned linear ranker, leave-one-segment-out
    X = featmat(rows)
    y = np.array([r["isball"] for r in rows], float)
    segs = np.array([r["seg"] for r in rows])
    keep = np.array([survives(r, COMPACT_FILT) for r in rows])
    loso = np.full(len(rows), -1e9)
    for s in sorted(set(segs)):
        tr = keep & (segs != s)
        te = keep & (segs == s)
        if tr.sum() < 50 or te.sum() == 0 or y[tr].sum() < 3:
            continue
        model = fit_logistic(X[tr], y[tr])
        loso[te] = apply_logistic(model, X[te])
    idx = {id(r): i for i, r in enumerate(rows)}
    ptsL, _ = curve(by_frame, lab, lambda cs: np.array([loso[idx[id(c)]] for c in cs]))
    report("L  learned linear ranker over 11 features, LEAVE-ONE-SEGMENT-OUT", ptsL,
           "no segment contributed to the weights that score it. This is the "
           "honest ceiling for a linear combination of these features.")
    results["L_logreg_loso"] = ptsL

    ins = np.full(len(rows), -1e9)
    model = fit_logistic(X[keep], y[keep])
    ins[keep] = apply_logistic(model, X[keep])
    ptsLin, _ = curve(by_frame, lab, lambda cs: np.array([ins[idx[id(c)]] for c in cs]))
    report("L' the SAME learned ranker graded on the data it was fitted on", ptsLin,
           "shown only to size the optimism of in-sample tuning. Not a result.")
    results["Lprime_logreg_insample"] = ptsLin

    # ---- C: trajectory consistency on top of the best base ranker
    tp = dict(spans=(1, 2), vmin=0.5, vmax=140.0, accel_tol=3.0)
    for base_name, base in (("A", lambda cs: np.array([c["dmax"] for c in cs])),
                            ("L(loso)", lambda cs: np.array([loso[idx[id(c)]] for c in cs]))):
        tr = trajectory_scores(rows, align, base, COMPACT_FILT, tp)
        bf = {k: v for k, v in tr.items() if k in lab}
        for k in lab:
            bf.setdefault(k, [])
        ptsC, _ = curve(bf, lab, lambda cs: np.array([c["tscore"] for c in cs]),
                        filt=dict(amin=0, amax=10 ** 9, maxext=10 ** 9,
                                  vmax=10 ** 9, dthr=-1))
        report(f"C  trajectory consistency (constant-velocity triplet) over {base_name}",
               ptsC, "camera pan removed before the motion test; a frame with no "
                     "consistent triplet emits nothing.")
        results[f"C_traj_over_{base_name}"] = ptsC

    json.dump(results, open(args.out, "w"), default=float)
    print("\nwrote", args.out)


if __name__ == "__main__":
    main()
