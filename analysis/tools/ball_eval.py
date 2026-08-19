#!/usr/bin/env python3
"""Score every ball detector against eval/ball_labels_v1.json as a CURVE.

A single operating point hides the only thing that matters for the product: a
detector that fires on 30% of frames may be plenty for bounce detection if its
false positives are rare, and useless at the same recall if they are not. So
every detector here is reported as recall vs false-positives-per-frame across
its whole confidence range, and an operating point is chosen only afterwards.

DECISION RULE (one ball per frame, which is what the product needs)
    Per frame, take the highest-scoring surviving candidate. Emit it if its
    score clears the threshold. Then
      TP  frame is labelled visible and the emission is within 8 px
      FP  an emission that is not a TP -- including every emission on a frame
          where no ball exists at all
      FN  a labelled-visible frame with no emission, or an emission elsewhere

BIAS, STATED WITH THE NUMBERS
    * Labels were placed with a 3-frame difference aid, and detectors A/B/C are
      that same arithmetic, so RECALL here is an optimistic ceiling. FP rates
      are unbiased: the labeller never enumerated non-ball movers.
    * Detector L is a learned linear ranker. It is reported ONLY under
      leave-one-segment-out cross-validation, so no segment contributes to the
      weights used to score it. Its in-sample number is printed alongside
      purely to show the size of the optimism.
    * Hand thresholds for A/B were chosen by looking at these same labels. The
      CURVE is therefore honest but any single point picked off it is
      tuned-on-test, and is labelled as such.
"""
import argparse
import json
import os
from collections import defaultdict

import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOL = 8.0
NULL_REASONS = {"noBallInFlight", "offFrame"}

FEATS = ["dmax", "dsum", "area", "elong", "vmed", "vmin", "streak",
         "ringcontrast", "playerdist", "w", "h"]


# ---------------------------------------------------------------- data
def load(labels_path, feat_path):
    labels = json.load(open(labels_path))
    tab = json.load(open(feat_path))
    rows = tab["rows"]
    # frame -> label, and the set of frames that are in the evaluation
    lab = {}
    segof = {}
    for s in labels["segments"]:
        for fl in s["frames"]:
            lab[(s["seg"], fl["f"])] = fl
            segof[(s["seg"], fl["f"])] = s["seg"]
    by_frame = defaultdict(list)
    for r in rows:
        by_frame[(r["seg"], r["f"])].append(r)
    return labels, rows, lab, by_frame, tab.get("align", {})


def featmat(rows):
    X = np.array([[r[f] for f in FEATS] for r in rows], float)
    X[:, FEATS.index("playerdist")] = np.minimum(X[:, FEATS.index("playerdist")], 300)
    return X


# ---------------------------------------------------------------- filters
def survives(r, p):
    if not (p["amin"] <= r["area"] <= p["amax"]):
        return False
    if max(r["w"], r["h"]) > p["maxext"]:
        return False
    if r["vmed"] > p["vmax"]:
        return False
    if r["dmax"] < p["dthr"]:
        return False
    # Compactness. Sub-pixel misalignment along a court line or wall edge leaves
    # a long 1 px sliver: clutter's median elongation is ~500 against the ball's
    # ~1.7, which makes an elongation CEILING the single cheapest clutter cut.
    # Note this is the opposite of the motion-streak hypothesis -- real blur does
    # raise ball elongation (2.25 for streak-labelled vs 1.49 for dot-labelled),
    # but never into the range the alignment slivers occupy.
    if p.get("emax") is not None and r["elong"] > p["emax"]:
        return False
    return True


DEFAULT_FILT = dict(amin=2, amax=120, maxext=22, vmax=170, dthr=8, emax=None)
COMPACT_FILT = dict(amin=2, amax=120, maxext=22, vmax=170, dthr=8, emax=6.0)


# ---------------------------------------------------------------- curve
def curve(by_frame, lab, scorer, filt=DEFAULT_FILT, tol=TOL, n_pts=60):
    """Best-candidate-per-frame emissions, then sweep the threshold."""
    best = {}
    for key, cands in by_frame.items():
        if key not in lab:
            continue
        ok = [c for c in cands if survives(c, filt)]
        if not ok:
            best[key] = None
            continue
        sc = scorer(ok)
        i = int(np.argmax(sc))
        best[key] = (float(sc[i]), ok[i])
    keys = [k for k in lab if k in best]
    scores = sorted({b[0] for b in best.values() if b is not None})
    if not scores:
        return [], {}
    qs = np.unique(np.quantile(scores, np.linspace(0, 1, n_pts)))
    pts = []
    for t in qs:
        tp = fp = 0
        nullfp = 0
        errs = []
        per_seg = defaultdict(lambda: [0, 0])
        for k in keys:
            fl = lab[k]
            b = best[k]
            emitted = b is not None and b[0] >= t
            if fl["s"] == "visible":
                per_seg[k[0]][1] += 1
            if not emitted:
                continue
            c = b[1]
            if fl["s"] == "visible":
                d = np.hypot(c["x"] - fl["x"], c["y"] - fl["y"])
                if d <= tol:
                    tp += 1
                    errs.append(d)
                    per_seg[k[0]][0] += 1
                else:
                    fp += 1
            else:
                fp += 1
                if fl.get("miss") in NULL_REASONS:
                    nullfp += 1
        npos = sum(1 for k in keys if lab[k]["s"] == "visible")
        nnull = sum(1 for k in keys if lab[k]["s"] != "visible"
                    and lab[k].get("miss") in NULL_REASONS)
        pts.append(dict(thr=float(t), tp=tp, fp=fp, npos=npos,
                        recall=tp / max(npos, 1),
                        fp_per_frame=fp / max(len(keys), 1),
                        null_fp_per_frame=nullfp / max(nnull, 1),
                        prec=tp / max(tp + fp, 1),
                        loc_med=float(np.median(errs)) if errs else None,
                        per_seg={k: list(v) for k, v in per_seg.items()}))
    return pts, best


def at_budget(pts, budget):
    """Highest-recall point whose FP/frame is within budget."""
    ok = [p for p in pts if p["fp_per_frame"] <= budget]
    return max(ok, key=lambda p: p["recall"]) if ok else None


def boot_ci(per_seg, n=10000, seed=20260818):
    """Cluster bootstrap over segments -- the ground truth's unit of independence."""
    names = [k for k, v in per_seg.items() if v[1] > 0]
    if not names:
        return (0.0, 0.0)
    num = np.array([per_seg[k][0] for k in names], float)
    den = np.array([per_seg[k][1] for k in names], float)
    rng = np.random.default_rng(seed)
    d = rng.integers(0, len(names), size=(n, len(names)))
    v = num[d].sum(1) / np.maximum(den[d].sum(1), 1e-9)
    return float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))


# ---------------------------------------------------------------- learned
def fit_logistic(X, y, iters=300, lr=0.5, l2=1e-3):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    Z = np.hstack([Z, np.ones((len(Z), 1))])
    w = np.zeros(Z.shape[1])
    pw = max((y == 0).sum() / max((y == 1).sum(), 1), 1.0)
    sw = np.where(y == 1, pw, 1.0)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ (sw * (p - y)) / len(Z) + l2 * w
        w -= lr * g
    return w, mu, sd


def apply_logistic(model, X):
    w, mu, sd = model
    Z = np.hstack([(X - mu) / sd, np.ones((len(X), 1))])
    return Z @ w
