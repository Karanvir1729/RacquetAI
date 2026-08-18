#!/usr/bin/env python3
"""Measure how often the A/B player labels are wrong, before and after the fix.

Method (the frame-by-frame audit that found the bug, made repeatable):

  1. Sample the clip at a fixed interval.
  2. At each instant take both tracked players' torso appearance and cluster all
     the samples into the two real people (2-means).
  3. Count how often the engine's A/B label disagrees with the appearance
     majority for that person -> percent-of-samples-mislabelled, and how often
     the label mapping changes between consecutive samples -> identity flips.

The ground truth here is shirt appearance, which is also what the fixed tracker
uses, so this measurement is deliberately built on a DIFFERENT reading of it than
the tracker's: a bigger region (the whole shoulders-to-hips box, not the inner
chest patch) reduced by a MEAN (not a median). Same physical cue, independent
numbers. It is a proxy, not hand-labelled truth -- see the caveat in --help.

Usage:
    identity_audit.py --clip archive_match2 [--interval 2.0]
    identity_audit.py --clip archive_match2 --calibrate   # descriptor weights + lambda
"""
import argparse
import json
import math
import os
import pickle
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import analyze  # noqa: E402
from analyze import (COURT_W, COURT_L, KPT_CONF, SAMPLE_FPS, L_SHO, R_SHO,  # noqa: E402
                     L_HIP, R_HIP, build_alignments, detect_players,
                     frame_exposure_ref)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GT_MARGIN_F = 0.25      # a sample counts only if it sits this much nearer its own
                        # cluster centroid than the other, as a fraction of the
                        # centroid separation -- ambiguous samples cannot be truth
GT_BOX_PAD = 0.15       # the ground-truth region is the torso box grown by this
MAX_GAP_S = 4.0         # longest gap between labelled frames still counted as one
                        # re-acquisition decision rather than a fresh acquisition


# ---------------------------------------------------------------- ground truth
def gt_appearance(frame, kpts, scores, exposure):
    """Independent appearance read: MEAN colour over the whole padded torso box."""
    if any(scores[j] <= KPT_CONF for j in (L_SHO, R_SHO, L_HIP, R_HIP)):
        return None
    pts = np.array([kpts[j] for j in (L_SHO, R_SHO, L_HIP, R_HIP)], dtype=np.float64)
    x0, y0 = pts[:, 0].min(), pts[:, 1].min()
    x1, y1 = pts[:, 0].max(), pts[:, 1].max()
    px, py = GT_BOX_PAD * (x1 - x0), GT_BOX_PAD * (y1 - y0)
    h, w = frame.shape[:2]
    xa, ya = max(0, int(round(x0 - px))), max(0, int(round(y0 - py)))
    xb, yb = min(w, int(round(x1 + px))), min(h, int(round(y1 + py)))
    if xb - xa < 2 or yb - ya < 2:
        return None
    m = frame[ya:yb, xa:xb].reshape(-1, 3).mean(axis=0)
    b, g, r = float(m[0]), float(m[1]), float(m[2])
    total = b + g + r
    if total < 1e-6:
        return None
    lum = total / 3.0
    return (r / total, g / total, math.log((lum + 1.0) / (max(exposure, 0.0) + 1.0)))


def load_gt(clip, out_dir, times, raw_frames, fps, duration):
    """Per-detection ground-truth descriptors, cached beside the pose cache."""
    path = os.path.join(out_dir, "identity_gt_v1.pkl")
    if os.path.exists(path):
        with open(path, "rb") as f:
            gt = pickle.load(f)
        if len(gt) == len(times):
            return gt
    cap = cv2.VideoCapture(os.path.join(ROOT, "samples", f"{clip}.mp4"))
    stride = max(1, round(fps / SAMPLE_FPS))
    gt = []
    j = idx = 0
    while j < len(times):
        ok, frame = cap.read()
        if not ok:
            break
        if idx % stride:
            idx += 1
            continue
        if idx / fps > duration:
            break
        exposure = frame_exposure_ref(frame)
        gt.append([gt_appearance(frame, d["kpts"], d["scores"], exposure)
                   for d in raw_frames[j]])
        j += 1
        idx += 1
    cap.release()
    if len(gt) != len(times):
        raise RuntimeError(f"decoded {len(gt)} of {len(times)} samples for {clip}")
    with open(path, "wb") as f:
        pickle.dump(gt, f)
    return gt


def gt_dist(u, v, cw, lw):
    return math.sqrt((cw * (u[0] - v[0])) ** 2 + (cw * (u[1] - v[1])) ** 2
                     + (lw * (u[2] - v[2])) ** 2)


def two_means(vecs, cw, lw, iters=50):
    """2-means over the weighted descriptor space; seeded by the farthest pair."""
    X = np.array([(cw * v[0], cw * v[1], lw * v[2]) for v in vecs])
    # seed on the principal axis extremes: cheap, deterministic, and these
    # clusters are two shirts, so the split is nowhere near marginal
    c = X - X.mean(axis=0)
    axis = np.linalg.svd(c, full_matrices=False)[2][0]
    proj = c @ axis
    cent = np.array([X[proj.argmin()], X[proj.argmax()]])
    lab = np.zeros(len(X), dtype=int)
    for _ in range(iters):
        d = np.stack([np.linalg.norm(X - cent[k], axis=1) for k in range(2)], axis=1)
        new = d.argmin(axis=1)
        if np.array_equal(new, lab) and _ > 0:
            break
        lab = new
        for k in range(2):
            if (lab == k).any():
                cent[k] = X[lab == k].mean(axis=0)
    return cent, lab


# ---------------------------------------------------------------- the old tracker
class LegacyTwoTracker:
    """Frozen copy of the pre-fix tracker: court-position distance only, with the
    `swap < keep * 0.7` guard. Kept here, not in analyze.py, purely so the audit
    can measure the same detections both ways."""

    def __init__(self):
        self.pos = {"A": None, "B": None}

    def update(self, dets, t=None):
        out = {}
        if len(dets) == 0:
            return out
        if self.pos["A"] is None and self.pos["B"] is None:
            dets = sorted(dets, key=lambda d: d["court"][0])
            out["A"] = dets[0]
            if len(dets) > 1:
                out["B"] = dets[1]
        elif len(dets) == 1:
            d = dets[0]
            out["A" if self._dist("A", d) <= self._dist("B", d) else "B"] = d
        else:
            d0, d1 = dets[0], dets[1]
            keep = self._dist("A", d0) + self._dist("B", d1)
            swap = self._dist("A", d1) + self._dist("B", d0)
            if swap < keep * 0.7:
                out["A"], out["B"] = d1, d0
            else:
                out["A"], out["B"] = d0, d1
        for pid, d in out.items():
            self.pos[pid] = d["court"]
        return out

    def _dist(self, pid, det):
        if self.pos[pid] is None:
            return 3.0
        p, q = self.pos[pid], det["court"]
        return math.hypot(p[0] - q[0], p[1] - q[1])


# ---------------------------------------------------------------- clip loading
def load_clip(clip):
    out_dir = os.path.join(ROOT, "out", f"{clip}_v2")
    video = os.path.join(ROOT, "samples", f"{clip}.mp4")
    corners = json.load(open(os.path.join(ROOT, "samples", f"{clip}.corners.json")))
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
    cap.release()

    v3 = os.path.join(out_dir, "pose_cache_v3.pkl")
    v2 = os.path.join(out_dir, "pose_cache_v2.pkl")
    if os.path.exists(v3):
        blob = pickle.load(open(v3, "rb"))
    else:
        blob = pickle.load(open(v2, "rb"))
        analyze.fill_appearance(video, blob["times"], blob["raw_frames"], fps, duration)
        pickle.dump(blob, open(v3, "wb"))
    times, raw_frames = blob["times"], blob["raw_frames"]

    c = corners["corners"]
    src = np.float32([c["frontLeft"], c["frontRight"], c["backLeft"], c["backRight"]])
    dst = np.float32([[0, 0], [COURT_W, 0], [0, COURT_L], [COURT_W, COURT_L]])
    H_ref2court = cv2.getPerspectiveTransform(src, dst)
    aligns, _ = build_alignments(blob["directs"], blob["steps"])

    gt = load_gt(clip, out_dir, times, raw_frames, fps, duration)
    # detect_players reorders, drops and re-wraps detections into fresh dicts, so
    # the ground-truth descriptor cannot ride along on the input dict. The kpts
    # array is passed through by reference, which makes it a stable join key.
    frames = []
    for i in range(len(times)):
        by_kpts = {id(d["kpts"]): g for d, g in zip(raw_frames[i], gt[i])}
        dets = detect_players(raw_frames[i], H_ref2court @ aligns[i])
        for d in dets:
            d["gt"] = by_kpts.get(id(d["kpts"]))
        frames.append(dets)
    return times, frames


def run_tracker(tracker, times, frames):
    return [tracker.update(list(dets), times[i]) for i, dets in enumerate(frames)]


# ---------------------------------------------------------------- the measurement
def measure(times, frames, tracked, interval, cw, lw):
    """Identity flips + percent mislabelled against the appearance majority."""
    # one sample per `interval`, at the nearest frame where both players are
    # tracked and both have a ground-truth descriptor
    picks, next_t = [], times[0]
    for i, t in enumerate(times):
        if t + 1e-9 < next_t:
            continue
        tf = tracked[i]
        if len(tf) == 2 and all(tf[p].get("gt") is not None for p in ("A", "B")):
            picks.append(i)
            next_t = t + interval
    if len(picks) < 8:
        return None

    vecs = [tracked[i][p]["gt"] for i in picks for p in ("A", "B")]
    cent, _ = two_means(vecs, cw, lw)
    sep = float(np.linalg.norm(cent[0] - cent[1]))

    def cluster_of(v):
        """(cluster, confident?) for one descriptor."""
        x = np.array([cw * v[0], cw * v[1], lw * v[2]])
        d0 = float(np.linalg.norm(x - cent[0]))
        d1 = float(np.linalg.norm(x - cent[1]))
        k = 0 if d0 <= d1 else 1
        return k, abs(d0 - d1) >= GT_MARGIN_F * sep

    kept = []          # (time, orientation) where orientation = cluster assigned to A
    for i in picks:
        ka, oka = cluster_of(tracked[i]["A"]["gt"])
        kb, okb = cluster_of(tracked[i]["B"]["gt"])
        if not (oka and okb) or ka == kb:
            continue   # appearance cannot separate them here, so it cannot judge
        kept.append((times[i], ka))
    if len(kept) < 8:
        return None

    orient = [k for _, k in kept]
    majority = 1 if sum(orient) * 2 > len(orient) else 0
    mislabelled = sum(1 for o in orient if o != majority)
    flips = sum(1 for a, b in zip(orient, orient[1:]) if a != b)
    return {
        "samples": len(kept),
        "candidates": len(picks),
        "flips": flips,
        "mislabelledPct": 100.0 * mislabelled / len(kept),
        "clusterSep": sep,
    }


# ---------------------------------------------------------------- calibration
def calibrate(clips, interval):
    """Pick the descriptor weights and lambda from the data, not by guessing.

    Weights: standardise each descriptor component by its WITHIN-person spread.
    For a two-class problem with roughly diagonal covariance that makes plain
    Euclidean distance the optimal discriminant, and it automatically damps a
    component that is noisy without being informative.

    Lambda: sweep it against an oracle-primed association test. Previous-frame
    positions and appearance templates are set from the ground-truth labels, so
    this scores the COST FUNCTION alone -- decoupled from the tracker's own
    history, and from the end-to-end numbers lambda is chosen to improve.

    Decisions are bucketed by the gap since the identity was last pinned down:

      ADJACENT (<= 1.5 sample periods) -- the easy case. A player cannot move far
        in 1/8 s, so position alone is already almost perfect here and the only
        thing appearance can do is add noise. This bucket is the guard rail.
      RE-ACQUISITION (up to 4 s) -- the case that actually breaks. Both players
        vanish into an occlusion or a missed detection, and when they re-emerge
        the position prior is stale and the pairing is close to a coin flip.
        This is where the identity flips are made, so this bucket picks lambda.
    """
    # provisional weights only to bootstrap the clustering; the reported weights
    # come out of the within-person spreads measured under them
    cw0, lw0 = analyze.APP_CHROMA_W, analyze.APP_LUMA_W
    # Everything below is computed PER CLIP and only the counts are aggregated.
    # Pooling the descriptors instead would compare person 0 of one match against
    # person 0 of another -- different humans in different shirts under different
    # lighting -- which inflates "within-person" spread until the descriptor looks
    # far weaker than it is (measured: luma separability 1.36 pooled, 1.6-6.3
    # per clip) and makes the oracle templates meaningless.
    within = []         # per-clip (chroma_std, luma_std)
    decisions = []      # per-decision precomputed costs, plain floats only
    per_clip = {}

    for clip in clips:
        times, frames = load_clip(clip)
        tracked = run_tracker(analyze.TwoTracker(), times, frames)
        picks = [i for i in range(len(times))
                 if len(tracked[i]) == 2
                 and all(tracked[i][p].get("gt") is not None for p in ("A", "B"))]
        vecs = [tracked[i][p]["gt"] for i in picks for p in ("A", "B")]
        cent, _ = two_means(vecs, cw0, lw0)
        sep = float(np.linalg.norm(cent[0] - cent[1]))

        def cluster_of(v):
            x = np.array([cw0 * v[0], cw0 * v[1], lw0 * v[2]])
            d = [float(np.linalg.norm(x - cent[k])) for k in range(2)]
            k = int(np.argmin(d))
            return k, abs(d[0] - d[1]) >= GT_MARGIN_F * sep

        # per-frame ground-truth identity for the two tracked detections
        truth = {}
        for i in picks:
            ka, oka = cluster_of(tracked[i]["A"]["gt"])
            kb, okb = cluster_of(tracked[i]["B"]["gt"])
            if oka and okb and ka != kb and all(tracked[i][p]["app"] is not None
                                                for p in ("A", "B")):
                truth[i] = {ka: tracked[i]["A"], kb: tracked[i]["B"]}
        pooled = {0: [d["app"] for m in truth.values() for k, d in m.items() if k == 0],
                  1: [d["app"] for m in truth.values() for k, d in m.items() if k == 1]}
        if min(len(pooled[0]), len(pooled[1])) < 20:
            print(f"  {clip}: too few labelled frames, skipped")
            continue
        comp = {}
        for c, name in ((0, "r"), (1, "g"), (2, "L")):
            sd = float(np.mean([np.std([a[c] for a in pooled[k]]) for k in (0, 1)]))
            gap = abs(float(np.mean([a[c] for a in pooled[0]]))
                      - float(np.mean([a[c] for a in pooled[1]])))
            comp[name] = (sd, gap)
        within.append((0.5 * (comp["r"][0] + comp["g"][0]), comp["L"][0]))
        print(f"\n  {clip}: within-person std / between-person gap / separability")
        for name in ("r", "g", "L"):
            sd, gap = comp[name]
            print(f"    {name}: std={sd:.4f} gap={gap:.4f} sep={gap / max(sd, 1e-9):.2f}")

        # this clip's own oracle templates: the mean descriptor of each real person
        tmpl = {k: tuple(float(np.mean([a[c] for a in pooled[k]])) for c in range(3))
                for k in (0, 1)}
        # each labelled frame paired with the next one -> one association decision.
        # The position and appearance halves of both pairings are resolved to plain
        # floats here: lambda only scales the appearance half, so the sweep needs
        # nothing else, and holding the detection dicts would pin every clip's pose
        # cache in memory at once -- which on this machine means swapping until the
        # disk is full.
        keys = sorted(truth)
        for a, b in zip(keys, keys[1:]):
            dt = times[b] - times[a]
            if dt > MAX_GAP_S:
                continue
            p0, p1 = truth[a][0]["court"], truth[a][1]["court"]
            c0, a0 = truth[b][0]["court"], truth[b][0]["app"]
            c1, a1 = truth[b][1]["court"], truth[b][1]["app"]
            scale = analyze.POS_SCALE_M + analyze.POS_SPEED_MS * dt
            D = analyze.appearance_distance
            decisions.append((
                # index 0 is person 0 and index 1 is person 1 by construction, so
                # `keep` is the truth and the cost fails whenever it prefers swap
                (math.hypot(p0[0] - c0[0], p0[1] - c0[1])
                 + math.hypot(p1[0] - c1[0], p1[1] - c1[1])) / scale,
                (math.hypot(p0[0] - c1[0], p0[1] - c1[1])
                 + math.hypot(p1[0] - c0[0], p1[1] - c0[1])) / scale,
                D(a0, tmpl[0]) + D(a1, tmpl[1]),
                D(a1, tmpl[0]) + D(a0, tmpl[1]),
                dt))
        per_clip[clip] = len(truth)
        del times, frames, tracked, truth, pooled

    # ---- weights from within-person spread, averaged over clips ----
    chroma_std = float(np.mean([w[0] for w in within]))
    luma_std = float(np.mean([w[1] for w in within]))
    print(f"\n  suggested APP_CHROMA_W = 1/{chroma_std:.4f} = {1.0 / chroma_std:.1f}")
    print(f"  suggested APP_LUMA_W   = 1/{luma_std:.4f} = {1.0 / luma_std:.1f}")
    print(f"  (weights currently compiled in: chroma {cw0}, luma {lw0})")

    # ---- lambda sweep on the oracle-primed association test ----
    adjacent = [d for d in decisions if d[4] <= 1.5 / SAMPLE_FPS]
    reacq = [d for d in decisions if d[4] > 1.5 / SAMPLE_FPS]
    print(f"\nlambda sweep over {len(decisions)} oracle-primed association decisions "
          f"({', '.join(f'{c}:{n}' for c, n in per_clip.items())} labelled frames)")
    print(f"  adjacent (<= {1.5 / SAMPLE_FPS:.3f}s): {len(adjacent)}   "
          f"re-acquisition (<= {MAX_GAP_S}s): {len(reacq)}")

    def errors(bucket, lam):
        return sum(1 for pk, ps, ak, asw, _ in bucket if ps + lam * asw < pk + lam * ak)

    print(f"\n{'lambda':>8} {'adjacent err':>22} {'re-acquisition err':>24}")
    rows = []
    for lam in (0.0, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0):
        ea, er = errors(adjacent, lam), errors(reacq, lam)
        rows.append((lam, ea, er))
        print(f"{lam:>8.2f} {ea:>8}/{len(adjacent)} ({100.0*ea/max(len(adjacent),1):>6.2f}%) "
              f"{er:>8}/{len(reacq)} ({100.0*er/max(len(reacq),1):>6.2f}%)")
    best = min(rows, key=lambda r: (r[2], r[1]))
    print(f"\nlowest re-acquisition error at lambda={best[0]} "
          f"({best[2]}/{len(reacq)}); adjacent cost at that lambda: "
          f"{best[1]}/{len(adjacent)}")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=(
        "CAVEAT: ground truth is an appearance proxy (mean colour of the torso "
        "box), not a human label. It is only valid where the two shirts differ; "
        "samples where the clustering is not confident are excluded rather than "
        "guessed, so the reported rates describe the clip's separable moments."))
    ap.add_argument("--clip", action="append", required=True,
                    help="clip stem, e.g. archive_match2 (repeatable)")
    ap.add_argument("--interval", type=float, default=2.0,
                    help="seconds between audit samples (default 2.0)")
    ap.add_argument("--calibrate", action="store_true",
                    help="report descriptor weights and the lambda sweep, then exit")
    args = ap.parse_args()

    if args.calibrate:
        calibrate(args.clip, args.interval)
        return

    cw, lw = analyze.APP_CHROMA_W, analyze.APP_LUMA_W
    print(f"{'clip':<18} {'tracker':<10} {'samples':>8} {'flips':>7} {'mislabelled':>12}")
    totals = {}
    for clip in args.clip:
        times, frames = load_clip(clip)
        for name, tracker in (("before", LegacyTwoTracker()), ("after", analyze.TwoTracker())):
            tracked = run_tracker(tracker, times, frames)
            m = measure(times, frames, tracked, args.interval, cw, lw)
            if m is None:
                print(f"{clip:<18} {name:<10} {'-- too few separable samples --':>30}")
                continue
            print(f"{clip:<18} {name:<10} {m['samples']:>8} {m['flips']:>7} "
                  f"{m['mislabelledPct']:>11.1f}%")
            t = totals.setdefault(name, {"s": 0, "f": 0, "m": 0.0})
            t["s"] += m["samples"]
            t["f"] += m["flips"]
            t["m"] += m["mislabelledPct"] * m["samples"] / 100.0
    print()
    for name in ("before", "after"):
        if name in totals:
            t = totals[name]
            print(f"ALL CLIPS {name:<8} samples={t['s']} flips={t['f']} "
                  f"mislabelled={100.0 * t['m'] / max(t['s'], 1):.1f}%")


if __name__ == "__main__":
    main()
