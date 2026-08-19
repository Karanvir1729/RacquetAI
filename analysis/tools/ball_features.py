#!/usr/bin/env python3
"""Extract a candidate feature TABLE once, so scoring experiments cost seconds.

Everything expensive -- warping, differencing, connected components, oriented
matched filtering, pose lookup -- happens here at a deliberately permissive
threshold. Every later experiment (filters, rankings, thresholds, trajectory
consistency, cross-validation) is pure numpy over the resulting table, which is
what makes an honest leave-one-segment-out sweep affordable at all.

Per candidate:
    x, y            residual-weighted centroid, in the frame's OWN pixels
    area, w, h      connected-component size
    elong, theta    from the residual-weighted second moments (a fast ball is a
                    short dark STREAK; elongation is evidence, not noise)
    dmax, dsum      residual strength
    vmed, vmin      absolute grey level (the ball is black)
    streak          peak response of an oriented line-kernel bank
    ringcontrast    how much darker the blob is than an annulus around it
    playerdist      px to the nearest pose keypoint in the nearest pose sample
    isball          1 if within TOL px of the hand label for that frame
"""
import argparse
import json
import os
import pickle

import cv2
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, "eval/ball_align_cache")
PAD = 4
FPS = 30000.0 / 1001.0
TOL = 8.0

DTHR_FLOOR = 6      # permissive: later experiments raise it, never lower it
AMIN, AMAX = 1, 400
MAXEXT = 60


def line_kernels(length=9, n_ang=12):
    ks = []
    for a in range(n_ang):
        th = np.pi * a / n_ang
        k = np.zeros((length, length), np.float32)
        c = length // 2
        for t in np.linspace(-c, c, length * 4):
            x = int(round(c + t * np.cos(th)))
            y = int(round(c + t * np.sin(th)))
            if 0 <= x < length and 0 <= y < length:
                k[y, x] = 1.0
        ks.append(k / k.sum())
    return ks


KERNELS = line_kernels()


def load_poses(clip):
    """frame index -> list of (N,2) keypoint arrays, from the existing cache."""
    p = os.path.join(REPO, "out", clip + "_v2", "pose_cache_v3.pkl")
    if not os.path.exists(p):
        return {}
    d = pickle.load(open(p, "rb"))
    out = {}
    for t, people in zip(d["times"], d["raw_frames"]):
        f = int(round(t * FPS))
        out[f] = [np.asarray(pp["kpts"]) for pp in people if pp is not None]
    return out


def nearest_pose(poses, frame):
    if not poses:
        return None
    f = min(poses.keys(), key=lambda k: abs(k - frame))
    if abs(f - frame) > 6:
        return None
    return poses[f]


class Seg:
    def __init__(self, path, meta):
        z = np.load(path)
        self.gray, self.Hstep = z["gray"], z["Hstep"]
        self.lo = int(z["lo"])
        self.meta, self.name, self.clip = meta, meta["seg"], meta["clip"]

    def warp_into(self, i, j):
        H = np.eye(3)
        if i < j:
            for k in range(i, j):
                H = self.Hstep[k] @ H
        elif i > j:
            for k in range(j, i):
                H = np.linalg.inv(self.Hstep[k]) @ H
        H = H / H[2, 2]
        h, w = self.gray[j].shape
        return cv2.warpPerspective(self.gray[i], H, (w, h), flags=cv2.INTER_LINEAR)


def residual(seg, j, erode_r=1):
    cur = seg.gray[j].astype(np.int16)
    acc = None
    for off in (-1, 1):
        i = j + off
        if not (0 <= i < len(seg.gray)):
            continue
        w = seg.warp_into(i, j)
        if erode_r:
            w = cv2.erode(w, np.ones((2 * erode_r + 1,) * 2, np.uint8))
        w = w.astype(np.int16)
        acc = w if acc is None else np.minimum(acc, w)
    if acc is None:
        return np.zeros(cur.shape, np.int16)
    return np.clip(acc - cur, 0, 255).astype(np.int16)


def extract(seg, poses):
    rows = []
    n = len(seg.meta["frames"])
    labmap = {fl["f"]: fl for fl in seg.meta["frames"]}
    for j in range(1, len(seg.gray) - 1):
        frame_no = seg.lo + j
        d = residual(seg, j)
        cur = seg.gray[j]
        mask = (d >= DTHR_FLOOR).astype(np.uint8)
        if not mask.any():
            continue
        ncc, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        people = nearest_pose(poses, frame_no)
        fl = labmap.get(frame_no)
        for c in range(1, ncc):
            area = int(stats[c, cv2.CC_STAT_AREA])
            w_ = int(stats[c, cv2.CC_STAT_WIDTH])
            h_ = int(stats[c, cv2.CC_STAT_HEIGHT])
            if area < AMIN or area > AMAX or max(w_, h_) > MAXEXT:
                continue
            ys, xs = np.where(lab == c)
            dv = d[ys, xs].astype(np.float64)
            wsum = dv.sum() + 1e-9
            cx = float((xs * dv).sum() / wsum)
            cy = float((ys * dv).sum() / wsum)
            # residual-weighted second moments -> elongation + orientation
            dx, dy = xs - cx, ys - cy
            cxx = float((dv * dx * dx).sum() / wsum)
            cyy = float((dv * dy * dy).sum() / wsum)
            cxy = float((dv * dx * dy).sum() / wsum)
            tr, det = cxx + cyy, cxx * cyy - cxy * cxy
            disc = max(tr * tr / 4 - det, 0.0) ** 0.5
            l1, l2 = tr / 2 + disc, max(tr / 2 - disc, 1e-6)
            elong = float((l1 / l2) ** 0.5)
            theta = float(0.5 * np.arctan2(2 * cxy, cxx - cyy))
            vals = cur[ys, xs].astype(np.float64)
            # annulus around the blob: is it locally dark, not just changed?
            y0, y1 = max(0, int(cy) - 6), min(cur.shape[0], int(cy) + 7)
            x0, x1 = max(0, int(cx) - 6), min(cur.shape[1], int(cx) + 7)
            patch = cur[y0:y1, x0:x1].astype(np.float64)
            pm = np.ones(patch.shape, bool)
            iy, ix = ys - y0, xs - x0
            ok = (iy >= 0) & (iy < patch.shape[0]) & (ix >= 0) & (ix < patch.shape[1])
            pm[iy[ok], ix[ok]] = False
            ring = float(np.median(patch[pm])) if pm.any() else float(np.median(patch))
            dp = d[y0:y1, x0:x1].astype(np.float32)
            streak = 0.0
            if dp.size:
                streak = max(float(cv2.filter2D(dp, -1, k).max()) for k in KERNELS)
            pd = 9999.0
            if people:
                allk = np.vstack(people)
                pd = float(np.min(np.hypot(allk[:, 0] - cx, allk[:, 1] - cy)))
            isball = 0
            if fl is not None and fl["s"] == "visible":
                if np.hypot(cx - fl["x"], cy - fl["y"]) <= TOL:
                    isball = 1
            rows.append(dict(seg=seg.name, clip=seg.clip, f=frame_no, j=j,
                             x=cx, y=cy, area=area, w=w_, h=h_,
                             elong=elong, theta=theta,
                             dmax=float(dv.max()), dsum=float(dv.sum()),
                             vmed=float(np.median(vals)), vmin=float(vals.min()),
                             streak=streak, ringcontrast=ring - float(np.median(vals)),
                             playerdist=pd, isball=isball))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(REPO, "eval/ball_labels_v1.json"))
    ap.add_argument("--cache", default=CACHE)
    ap.add_argument("--out", default=os.path.join(REPO, "eval/ball_cand_features.json"))
    args = ap.parse_args()
    labels = json.load(open(args.labels))
    allrows, hstep = [], {}
    for m in labels["segments"]:
        p = os.path.join(args.cache, m["seg"].replace("#", "_s") + ".npz")
        if not os.path.exists(p):
            continue
        seg = Seg(p, m)
        poses = load_poses(m["clip"])
        r = extract(seg, poses)
        allrows += r
        hstep[m["seg"]] = {"lo": seg.lo, "Hstep": seg.Hstep.tolist()}
        nb = sum(x["isball"] for x in r)
        print(f"{m['seg']:22s} cands={len(r):6d}  matching-label={nb}")
    json.dump({"tol": TOL, "dthrFloor": DTHR_FLOOR, "rows": allrows,
               "align": hstep}, open(args.out, "w"))
    print("wrote", args.out, len(allrows), "candidates")


if __name__ == "__main__":
    main()
