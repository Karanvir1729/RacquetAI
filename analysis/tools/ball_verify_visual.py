#!/usr/bin/env python3
"""Render what the detector actually emitted, so a human can check the numbers.

A recall figure is worth nothing until someone has looked at the frames behind
it. This draws, per labelled frame, a magnified crop with the hand label (green)
and the detector's emission (magenta) marked, plus a verdict.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_eval import (REPO, TOL, load, featmat, survives,  # noqa: E402
                       COMPACT_FILT, fit_logistic, apply_logistic)
from ball_experiments import trajectory_scores  # noqa: E402

ZOOM = 6
CROP = 90


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seg", default="archive_match4#0")
    ap.add_argument("--thr", type=float, default=None)
    ap.add_argument("--budget", type=float, default=0.05)
    ap.add_argument("--outdir", default="/private/tmp/claude-501/-Users-karanvirkhanna-RacquetAI/f16894f8-b558-4d9d-855c-ef58dc45c3e4/scratchpad/ballviz")
    args = ap.parse_args()

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

    # threshold that meets the FP budget, chosen exactly as the report does
    best = {}
    for k in lab:
        cs = tr.get(k, [])
        if cs:
            i = int(np.argmax([c["tscore"] for c in cs]))
            best[k] = (cs[i]["tscore"], cs[i])
        else:
            best[k] = None
    if args.thr is None:
        cand_thrs = sorted({b[0] for b in best.values() if b})
        thr = None
        for t in cand_thrs:
            fp = sum(1 for k, b in best.items() if b and b[0] >= t and not (
                lab[k]["s"] == "visible"
                and np.hypot(b[1]["x"] - lab[k]["x"], b[1]["y"] - lab[k]["y"]) <= TOL))
            if fp / len(lab) <= args.budget:
                thr = t
                break
        thr = thr if thr is not None else max(cand_thrs)
    else:
        thr = args.thr
    print(f"operating threshold {thr:.3f} (FP/frame budget {args.budget})")

    segmeta = {s["seg"]: s for s in labels["segments"]}[args.seg]
    z = np.load(os.path.join(REPO, "eval/ball_align_cache",
                             args.seg.replace("#", "_s") + ".npz"))
    gray, lo = z["gray"], int(z["lo"])
    os.makedirs(args.outdir, exist_ok=True)

    tiles = []
    verdicts = []
    for fl in segmeta["frames"]:
        f = fl["f"]
        b = best.get((args.seg, f))
        emit = b[1] if (b and b[0] >= thr) else None
        img = cv2.cvtColor(gray[f - lo], cv2.COLOR_GRAY2BGR)
        if fl["s"] == "visible":
            cx, cy = fl["x"], fl["y"]
        elif emit is not None:
            cx, cy = emit["x"], emit["y"]
        else:
            cx, cy = img.shape[1] // 2, img.shape[0] // 2
        x0 = int(np.clip(cx - CROP // 2, 0, img.shape[1] - CROP))
        y0 = int(np.clip(cy - CROP // 2, 0, img.shape[0] - CROP))
        crop = img[y0:y0 + CROP, x0:x0 + CROP].copy()
        crop = cv2.resize(crop, (CROP * ZOOM, CROP * ZOOM),
                          interpolation=cv2.INTER_NEAREST)
        if fl["s"] == "visible":
            cv2.circle(crop, (int((fl["x"] - x0) * ZOOM), int((fl["y"] - y0) * ZOOM)),
                       11, (0, 255, 0), 2)
        if emit is not None:
            cv2.drawMarker(crop, (int((emit["x"] - x0) * ZOOM),
                                  int((emit["y"] - y0) * ZOOM)),
                           (255, 0, 255), cv2.MARKER_CROSS, 22, 2)
        if fl["s"] == "visible" and emit is not None:
            d = np.hypot(emit["x"] - fl["x"], emit["y"] - fl["y"])
            v = f"TP {d:.1f}px" if d <= TOL else f"FP {d:.0f}px off"
        elif fl["s"] == "visible":
            v = "MISS (no emission)"
        elif emit is not None:
            v = f"FP ({fl.get('miss')})"
        else:
            v = f"ok-silent ({fl.get('miss')})"
        verdicts.append((f, v))
        col = (0, 200, 0) if v.startswith(("TP", "ok")) else (
            (0, 0, 255) if v.startswith("FP") else (0, 165, 255))
        cv2.rectangle(crop, (0, 0), (crop.shape[1] - 1, crop.shape[0] - 1), col, 3)
        cv2.putText(crop, f"f{f} {v}", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (255, 255, 255), 3, cv2.LINE_AA)
        cv2.putText(crop, f"f{f} {v}", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    col, 1, cv2.LINE_AA)
        tiles.append(crop)

    cols = 4
    rowsn = (len(tiles) + cols - 1) // cols
    H, W = tiles[0].shape[:2]
    sheet = np.zeros((rowsn * H, cols * W, 3), np.uint8)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = t
    out = os.path.join(args.outdir, args.seg.replace("#", "_s") + "_verify.png")
    cv2.imwrite(out, sheet)
    print("wrote", out)
    for f, v in verdicts:
        print(f"   f{f}  {v}")


if __name__ == "__main__":
    main()
