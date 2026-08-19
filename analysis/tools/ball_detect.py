#!/usr/bin/env python3
"""Ball-detection experiments, scored against eval/ball_labels_v1.json.

THE CIRCULARITY THAT MUST BE STATED WITH EVERY NUMBER
    The labeller used a 3-frame aligned difference composite to decide WHERE to
    look before confirming the ball by eye in raw pixels. Detectors A and B here
    are arithmetically that same difference. So their RECALL against these
    labels is an optimistic ceiling, not an unbiased estimate: a ball that
    differencing could never surface is, in part, a ball that would have been
    labelled notVisible. Precision/false-positive rates carry no such bias --
    the labeller never enumerated non-ball movers -- so the FP numbers are
    clean, and a negative result on recall is doubly damning.

DETECTORS
    A  dark-mover differencing. Neighbours t-1, t+1 are warped into t and the
       residual d = min(erode(prev), erode(next)) - cur is thresholded. The
       erosion is the misalignment guard: if any pixel within r of the
       neighbour's matching site was also dark, the darkness at t is
       explainable by a sub-pixel shift and is not evidence of a new object.
    B  A, plus an oriented matched filter -- a fast ball at 30 fps is a short
       dark STREAK, so candidates are rescored by the best response over a bank
       of line kernels, and elongation becomes evidence instead of noise.
    C  trajectory consistency: keep the top-N candidates per frame from A or B
       and retain only those lying on a near-constant-velocity triplet across
       t-1, t, t+1. Rejects one-frame movers (a shoe, a shadow, a logo).

SCORING
    recall      over the 59 frames carrying a labelled position
    FP/frame    over all 156 labelled frames, and separately over the 48 frames
                where no ball is in flight or in shot at all (a clean null)
    loc error   pixel distance from detection to label, over hits
    Tolerance defaults to 8 px: the ball is 2-3 px and the labeller's own read
    repeatability is +/-2 px, so anything tighter measures the ruler.
"""
import argparse
import itertools
import json
import os

import cv2
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, "eval/ball_align_cache")
PAD = 4

# frames with these miss reasons contain no ball to find at all -> clean null
NULL_REASONS = {"noBallInFlight", "offFrame"}


# ---------------------------------------------------------------- cache access
class Segment:
    def __init__(self, path, seg_meta):
        z = np.load(path)
        self.gray = z["gray"]
        self.Hstep = z["Hstep"]
        self.inl = z["inl"]
        self.lo = int(z["lo"])
        self.meta = seg_meta
        self.name = seg_meta["seg"]
        self.clip = seg_meta["clip"]

    def idx(self, frame_no):
        return frame_no - self.lo

    def warp_into(self, i, j):
        """Frame i warped into frame j's coordinates + validity mask."""
        H = np.eye(3)
        if i < j:
            for k in range(i, j):
                H = self.Hstep[k] @ H
        elif i > j:
            for k in range(j, i):
                H = np.linalg.inv(self.Hstep[k]) @ H
        H = H / H[2, 2]
        h, w = self.gray[j].shape
        out = cv2.warpPerspective(self.gray[i], H, (w, h), flags=cv2.INTER_LINEAR)
        val = cv2.warpPerspective(np.full(self.gray[i].shape, 255, np.uint8), H,
                                  (w, h), flags=cv2.INTER_NEAREST)
        return out, val > 0


def load_segments(labels):
    segs = []
    for m in labels["segments"]:
        p = os.path.join(CACHE, m["seg"].replace("#", "_s") + ".npz")
        if os.path.exists(p):
            segs.append(Segment(p, m))
    return segs


# ---------------------------------------------------------------- detector A/B
LINE_KERNELS = None


def _line_kernels(length=9, n_ang=8):
    """Unit-sum line kernels at n_ang orientations, for streak matching."""
    global LINE_KERNELS
    if LINE_KERNELS is not None:
        return LINE_KERNELS
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
        k /= k.sum()
        ks.append(k)
    LINE_KERNELS = ks
    return ks


def residual(seg, j, erode_r=1, span=1):
    """d = min over neighbours of erode(neighbour) - cur, clipped at 0.

    Larger d means "this pixel is darker now than anything nearby was in either
    neighbouring frame", i.e. a dark object has arrived that a sub-pixel
    misalignment cannot explain.
    """
    cur = seg.gray[j].astype(np.int16)
    acc = None
    validity = np.ones(cur.shape, bool)
    for off in (-span, span):
        i = j + off
        if i < 0 or i >= len(seg.gray):
            continue
        w, v = seg.warp_into(i, j)
        if erode_r > 0:
            k = np.ones((2 * erode_r + 1, 2 * erode_r + 1), np.uint8)
            w = cv2.erode(w, k)
        w = w.astype(np.int16)
        acc = w if acc is None else np.minimum(acc, w)
        validity &= v
    if acc is None:
        return np.zeros(cur.shape, np.int16), validity
    d = np.clip(acc - cur, 0, 255).astype(np.int16)
    d[~validity] = 0
    return d, validity


def candidates(seg, j, p):
    """Candidate ball positions in frame j's own pixel coordinates."""
    d, valid = residual(seg, j, p["erode_r"], p.get("span", 1))
    mask = (d >= p["dthr"]).astype(np.uint8)
    if not mask.any():
        return []
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    cur = seg.gray[j]
    out = []
    for c in range(1, n):
        area = stats[c, cv2.CC_STAT_AREA]
        if area < p["amin"] or area > p["amax"]:
            continue
        w_, h_ = stats[c, cv2.CC_STAT_WIDTH], stats[c, cv2.CC_STAT_HEIGHT]
        if max(w_, h_) > p["maxext"]:
            continue
        ys, xs = np.where(lab == c)
        vals = cur[ys, xs]
        # the ball is black: reject candidates that are merely "changed"
        if np.median(vals) > p["vmax"]:
            continue
        dv = d[ys, xs]
        # centroid weighted by residual strength
        wsum = dv.sum() + 1e-6
        cx = float((xs * dv).sum() / wsum)
        cy = float((ys * dv).sum() / wsum)
        elong = max(w_, h_) / max(1.0, min(w_, h_))
        score = float(dv.max())
        if p.get("streak"):
            k = _line_kernels(p.get("klen", 9))
            r = p.get("klen", 9) // 2
            y0, y1 = max(0, int(cy) - r - 2), min(d.shape[0], int(cy) + r + 3)
            x0, x1 = max(0, int(cx) - r - 2), min(d.shape[1], int(cx) + r + 3)
            patch = d[y0:y1, x0:x1].astype(np.float32)
            if patch.size:
                best = max(float(cv2.filter2D(patch, -1, kk).max()) for kk in k)
                score = best * (1.0 + p.get("elong_w", 0.0) * min(elong, 4.0))
        out.append({"x": cx, "y": cy, "area": int(area), "score": score,
                    "elong": float(elong), "dmax": int(dv.max()),
                    "val": float(np.median(vals))})
    out.sort(key=lambda c: -c["score"])
    return out[: p.get("topn", 50)]


# ---------------------------------------------------------------- detector C
def to_ref(seg, j, cands, ref):
    """Candidate positions mapped from frame j's coordinates into the segment
    reference frame, so that camera pan is removed before any motion reasoning.

    Without this the camera's own displacement enters the acceleration budget
    and a hand-held pan looks like ball acceleration.
    """
    if not cands:
        return np.zeros((0, 2))
    H = np.eye(3)
    if j < ref:
        for k in range(j, ref):
            H = seg.Hstep[k] @ H
    elif j > ref:
        for k in range(ref, j):
            H = np.linalg.inv(seg.Hstep[k]) @ H
    H = H / H[2, 2]
    pts = np.array([[c["x"], c["y"]] for c in cands], np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, H).reshape(-1, 2)


def trajectory_filter(seg, per_frame, p, ref):
    """Keep candidates lying on a near-constant-velocity triplet.

    Matching runs in REFERENCE coordinates (camera pan removed), over the
    symmetric pairs (t-1, t+1) and, for slow balls whose one-frame step is
    inside the position noise, (t-2, t+2). Between contacts the ball is
    near-ballistic, so a constant-velocity midpoint test is the right model;
    at a wall or floor contact the triplet legitimately breaks, which costs
    recall precisely at the frames a bounce detector would care about.
    """
    refc = {j: to_ref(seg, j, cs, ref) for j, cs in per_frame.items()}
    keep = {}
    for j, cands in per_frame.items():
        C = refc[j]
        best = [None] * len(C)
        for span in p.get("spans", (1, 2)):
            P_, N_ = refc.get(j - span), refc.get(j + span)
            if P_ is None or N_ is None or len(P_) == 0 or len(N_) == 0 or len(C) == 0:
                continue
            # predicted next position for every (prev, cur) pair
            pred = 2.0 * C[None, :, :] - P_[:, None, :]          # (np, nc, 2)
            dd = np.linalg.norm(pred[:, :, None, :] - N_[None, None, :, :], axis=-1)
            step = np.linalg.norm(C[None, :, :] - P_[:, None, :], axis=-1)
            ok_speed = (step >= p["vmin"] * span) & (step <= p["vmax_traj"] * span)
            dd = np.where(ok_speed[:, :, None], dd, np.inf)
            for ci in range(len(C)):
                sub = dd[:, ci, :]
                if not np.isfinite(sub).any():
                    continue
                pi, ni = np.unravel_index(np.argmin(sub), sub.shape)
                err = float(sub[pi, ni])
                if err > p["accel_tol"] * span:
                    continue
                tot = (per_frame[j - span][pi]["score"] + cands[ci]["score"]
                       + per_frame[j + span][ni]["score"])
                cand = (tot, err, float(step[pi, ci]) / span, span)
                if best[ci] is None or tot > best[ci][0]:
                    best[ci] = cand
        good = []
        for ci, b in enumerate(best):
            if b is None:
                continue
            cc = dict(cands[ci])
            cc["traj_score"], cc["traj_err"] = b[0], b[1]
            cc["speed"], cc["span"] = b[2], b[3]
            good.append(cc)
        good.sort(key=lambda c: -c["traj_score"])
        keep[j] = good[: p.get("topn_traj", 5)]
    return keep


# ---------------------------------------------------------------- scoring
def run_detector(segs, p, use_traj=False):
    """Return per-labelled-frame results: (segname, frameno, label, cands)."""
    rows = []
    for seg in segs:
        n = len(seg.meta["frames"])
        j0 = PAD
        per_frame = {}
        for k in range(-PAD + 1, n + PAD - 1):
            j = j0 + k
            if 1 <= j < len(seg.gray) - 1:
                per_frame[j] = candidates(seg, j, p)
        if use_traj:
            per_frame = trajectory_filter(seg, per_frame, p, j0 + n // 2)
        for k, fl in enumerate(seg.meta["frames"]):
            j = j0 + k
            rows.append({"seg": seg.name, "clip": seg.clip, "f": fl["f"],
                         "label": fl, "cands": per_frame.get(j, [])})
    return rows


def score(rows, tol=8.0, topk=1):
    """Aggregate. topk = how many candidates per frame the consumer may take."""
    hits = pos = 0
    fp = 0
    nframes = 0
    null_fp = 0
    null_frames = 0
    errs = []
    per_seg = {}
    for r in rows:
        nframes += 1
        lab = r["label"]
        cands = r["cands"][:topk]
        s = per_seg.setdefault(r["seg"], {"hit": 0, "pos": 0, "fp": 0, "n": 0})
        s["n"] += 1
        if lab["s"] == "visible":
            pos += 1
            s["pos"] += 1
            d = [np.hypot(c["x"] - lab["x"], c["y"] - lab["y"]) for c in cands]
            ok = [i for i, v in enumerate(d) if v <= tol]
            if ok:
                hits += 1
                s["hit"] += 1
                errs.append(min(d))
                fp += len(cands) - 1
                s["fp"] += len(cands) - 1
            else:
                fp += len(cands)
                s["fp"] += len(cands)
        else:
            fp += len(cands)
            s["fp"] += len(cands)
            if lab.get("miss") in NULL_REASONS:
                null_frames += 1
                null_fp += len(cands)
    return {
        "recall": hits / pos if pos else 0.0, "hits": hits, "positives": pos,
        "fp_total": fp, "frames": nframes, "fp_per_frame": fp / max(nframes, 1),
        "null_fp_per_frame": null_fp / max(null_frames, 1),
        "null_frames": null_frames,
        "loc_med": float(np.median(errs)) if errs else None,
        "loc_p90": float(np.percentile(errs, 90)) if errs else None,
        "per_seg": per_seg,
    }


# ---------------------------------------------------------------- bootstrap
def cluster_bootstrap(per_seg, key_num, key_den, n=10000, seed=20260818):
    """CI over SEGMENTS, matching the ground-truth file's unit of independence."""
    rng = np.random.default_rng(seed)
    names = [k for k in per_seg if per_seg[k][key_den] > 0]
    if not names:
        return (0.0, 0.0)
    num = np.array([per_seg[k][key_num] for k in names], float)
    den = np.array([per_seg[k][key_den] for k in names], float)
    m = len(names)
    draws = rng.integers(0, m, size=(n, m))
    vals = num[draws].sum(1) / np.maximum(den[draws].sum(1), 1e-9)
    return (float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(REPO, "eval/ball_labels_v1.json"))
    ap.add_argument("--tol", type=float, default=8.0)
    args = ap.parse_args()
    labels = json.load(open(args.labels))
    segs = load_segments(labels)
    p = dict(erode_r=1, dthr=18, amin=2, amax=120, maxext=22, vmax=150, topn=50)
    rows = run_detector(segs, p)
    print(json.dumps(score(rows, args.tol), indent=1, default=float)[:1200])


if __name__ == "__main__":
    main()
