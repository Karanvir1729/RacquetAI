#!/usr/bin/env python3
"""Same detector, three input conditions -- does resolution actually help IT?

The ground-truth file already established that 1080p helps a HUMAN (8/12 ->
12/12 on the fast-streak segment). That does not by itself mean it helps an
algorithm, and the investment decision needs the algorithm's answer.

CONDITIONS
    mp4_480     854x480 H.264, exactly what the pipeline ingests today
    hires_480   the 1920x1080 original, downscaled to 854x480
    hires_1080  the 1920x1080 original, native

    hires_480 is the control that separates "more pixels" from "a cleaner
    encode". Without it, any gain at 1080p could just be the mp4's compression
    noise, and the recommendation ("re-ingest at 1080p") would be wrong -- the
    fix would be "re-encode at a higher bitrate", which is far cheaper.

Detections are mapped DOWN into 854x480 coordinates and scored against the one
existing, already-validated label set, so no new hand-labelling is required and
the three conditions are judged by an identical yardstick.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_features import residual, line_kernels  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SP = ("/private/tmp/claude-501/-Users-karanvirkhanna-RacquetAI/"
      "f16894f8-b558-4d9d-855c-ef58dc45c3e4/scratchpad")
SEGDIRS = {"archive_match4#0": "hr_m4s0", "archive_match4#1": "hr_m4s1",
           "archive_match4#2": "hr_m4s2"}
KERNELS = line_kernels()
TOL = 8.0
TOL_TIGHT = 5.0


class Stack:
    """Grayscale frames + consecutive homographies, whatever the source."""

    def __init__(self, gray, frames, sx, sy):
        self.gray, self.frames = gray, frames
        self.sx, self.sy = sx, sy      # multiply to get 854x480 coordinates
        orb = cv2.ORB_create(2500)
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        feats = [orb.detectAndCompute(g, None) for g in gray]
        self.Hstep = []
        for i in range(len(gray) - 1):
            H = _fit(feats[i], feats[i + 1], bf)
            self.Hstep.append(np.eye(3) if H is None else H)
        self.Hstep = np.array(self.Hstep)

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


def _fit(fa, fb, bf):
    ka, da = fa
    kb, db = fb
    if da is None or db is None or len(ka) < 30 or len(kb) < 30:
        return None
    m = bf.match(da, db)
    if len(m) < 30:
        return None
    m = sorted(m, key=lambda x: x.distance)[:600]
    p = np.float32([ka[x.queryIdx].pt for x in m]).reshape(-1, 1, 2)
    q = np.float32([kb[x.trainIdx].pt for x in m]).reshape(-1, 1, 2)
    H, _ = cv2.findHomography(p, q, cv2.RANSAC, 3.0)
    if H is None:
        return None
    return H / H[2, 2]


def load_stacks(seg, lo, n):
    """Longest contiguous run of available high-res frames covering the segment.

    f2600 of archive_match4 is absent from the .mov at the same index on two
    independent fetches, so it is a genuine duplicated/dropped frame in the
    source rather than a seek artifact. The run is truncated around it instead
    of interpolating anything -- a fabricated frame would flow straight into the
    residual and invent a mover.
    """
    d = os.path.join(SP, SEGDIRS[seg])
    have = [f for f in range(lo, lo + n)
            if os.path.exists(os.path.join(d, f"f{f}.png"))]
    if not have:
        return None
    runs, cur = [], [have[0]]
    for f in have[1:]:
        if f == cur[-1] + 1:
            cur.append(f)
        else:
            runs.append(cur)
            cur = [f]
    runs.append(cur)
    frames = max(runs, key=len)
    if len(frames) < 5:
        return None
    lo, n = frames[0], len(frames)
    hs = [cv2.imread(os.path.join(d, f"f{f}.png"), cv2.IMREAD_GRAYSCALE)
          for f in frames]
    cap = cv2.VideoCapture(os.path.join(REPO, "samples", "archive_match4.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
    mp = []
    for _ in range(n):
        ok, fr = cap.read()
        if not ok:
            return None
        mp.append(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY))
    cap.release()
    H1, W1 = hs[0].shape
    down = [cv2.resize(g, (854, 480), interpolation=cv2.INTER_AREA) for g in hs]
    return {
        "mp4_480": Stack(mp, frames, 1.0, 1.0),
        "hires_480": Stack(down, frames, 1.0, 1.0),
        "hires_1080": Stack(hs, frames, 854.0 / W1, 480.0 / H1),
        "frames": frames,
    }


def candidates(st, j, scale, dthr=8):
    """Candidates in 854x480 coordinates. Geometry limits scale with the input."""
    d = residual(st, j)
    cur = st.gray[j]
    amin, amax = max(1, int(2 * scale ** 2)), int(120 * scale ** 2)
    maxext = int(22 * scale)
    mask = (d >= dthr).astype(np.uint8)
    if not mask.any():
        return []
    ncc, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for c in range(1, ncc):
        area = int(stats[c, cv2.CC_STAT_AREA])
        w_, h_ = int(stats[c, cv2.CC_STAT_WIDTH]), int(stats[c, cv2.CC_STAT_HEIGHT])
        if area < amin or area > amax or max(w_, h_) > maxext:
            continue
        ys, xs = np.where(lab == c)
        dv = d[ys, xs].astype(np.float64)
        ws = dv.sum() + 1e-9
        cx, cy = float((xs * dv).sum() / ws), float((ys * dv).sum() / ws)
        dx, dy = xs - cx, ys - cy
        cxx = float((dv * dx * dx).sum() / ws)
        cyy = float((dv * dy * dy).sum() / ws)
        cxy = float((dv * dx * dy).sum() / ws)
        tr, det = cxx + cyy, cxx * cyy - cxy * cxy
        disc = max(tr * tr / 4 - det, 0.0) ** 0.5
        l1, l2 = tr / 2 + disc, max(tr / 2 - disc, 1e-6)
        if (l1 / l2) ** 0.5 > 6.0:
            continue
        if float(np.median(cur[ys, xs])) > 170:
            continue
        out.append({"x": cx * st.sx, "y": cy * st.sy, "dmax": float(dv.max()),
                    "area": area})
    out.sort(key=lambda c: -c["dmax"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "eval/ball_resolution_detector.json"))
    args = ap.parse_args()
    labels = json.load(open(os.path.join(REPO, "eval/ball_labels_v1.json")))
    meta = {s["seg"]: s for s in labels["segments"]}

    conds = ["mp4_480", "hires_480", "hires_1080"]
    DTHRS = (6, 8, 12, 16, 22, 30)
    stacks = {}
    for seg in SEGDIRS:
        m = meta[seg]
        st = load_stacks(seg, m["startFrame"] - 2, len(m["frames"]) + 4)
        if st is None:
            print("no usable high-res run for", seg)
            continue
        stacks[seg] = st

    # Each condition gets its OWN best threshold. Handing 1080p the parameters
    # tuned for 480p would manufacture the negative result this test exists to
    # check, so every condition is scored at its own optimum -- which is
    # tuned-on-test for all three equally, and therefore a fair comparison.
    results = {}
    for c in conds:
        scale = 1.0 if c != "hires_1080" else 1080.0 / 480.0
        results[c] = {}
        for dthr in DTHRS:
            inset = t1 = t5 = pos = tight = 0
            ranks, ncand, errs = [], [], []
            for seg, st in stacks.items():
                s, m = st[c], meta[seg]
                lo = st["frames"][0]
                for fl in m["frames"]:
                    j = fl["f"] - lo
                    if not (1 <= j < len(s.gray) - 1):
                        continue
                    cands = candidates(s, j, scale, dthr)
                    ncand.append(len(cands))
                    if fl["s"] != "visible":
                        continue
                    pos += 1
                    dd = [np.hypot(cc["x"] - fl["x"], cc["y"] - fl["y"])
                          for cc in cands]
                    rank = next((i + 1 for i, v in enumerate(dd) if v <= TOL), None)
                    if rank:
                        inset += 1
                        ranks.append(rank)
                        errs.append(min(dd))
                        t1 += rank == 1
                        t5 += rank <= 5
                        tight += min(dd) <= TOL_TIGHT
            results[c][dthr] = dict(
                inset=inset, top1=t1, top5=t5, pos=pos, tight=tight,
                medrank=float(np.median(ranks)) if ranks else None,
                ncand=float(np.mean(ncand)) if ncand else 0.0,
                locmed=float(np.median(errs)) if errs else None)

    print("=" * 78)
    print("RESOLUTION EFFECT ON THE DETECTOR -- each condition at its OWN best")
    print("=" * 78)
    print("residual threshold sweep, 'ball in candidate set' / positives:")
    print(f"{'dthr':>6}" + "".join(f"{c:>14}" for c in conds))
    for dthr in DTHRS:
        row = f"{dthr:>6}"
        for c in conds:
            r = results[c][dthr]
            row += f"{r['inset']:>7d}/{r['pos']:<6d}"
        print(row)
    print()
    print(f"{'condition':>11} {'best dthr':>10} {'in set':>10} {'top-1':>7} "
          f"{'top-5':>7} {'med rank':>9} {'cand/frame':>11} {'<=5px':>7}")
    for c in conds:
        bd = max(DTHRS, key=lambda d: (results[c][d]["inset"],
                                       -results[c][d]["ncand"]))
        r = results[c][bd]
        mr = f"{r['medrank']:.0f}" if r["medrank"] else "-"
        print(f"{c:>11} {bd:>10} {r['inset']:>4d}/{r['pos']:<5d} {r['top1']:>7d} "
              f"{r['top5']:>7d} {mr:>9} {r['ncand']:>11.0f} "
              f"{r['tight']:>3d}/{r['pos']:<3d}")

    # ---- paired per-frame comparison (far more powerful than marginals at n=25)
    print()
    print("=" * 78)
    print("PAIRED PER-FRAME TEST: exact same frames, each condition at its best")
    print("=" * 78)
    best_d = {c: max(DTHRS, key=lambda d: (results[c][d]["inset"],
                                           -results[c][d]["ncand"])) for c in conds}
    found = {c: {} for c in conds}
    for c in conds:
        scale = 1.0 if c != "hires_1080" else 1080.0 / 480.0
        for seg, st in stacks.items():
            s, m = st[c], meta[seg]
            lo = st["frames"][0]
            for fl in m["frames"]:
                j = fl["f"] - lo
                if not (1 <= j < len(s.gray) - 1) or fl["s"] != "visible":
                    continue
                cands = candidates(s, j, scale, best_d[c])
                dd = [np.hypot(cc["x"] - fl["x"], cc["y"] - fl["y"]) for cc in cands]
                found[c][(seg, fl["f"])] = any(v <= TOL for v in dd)
    keys = sorted(found["mp4_480"])
    for a, b in (("mp4_480", "hires_1080"), ("mp4_480", "hires_480")):
        only_a = sum(1 for k in keys if found[a][k] and not found[b][k])
        only_b = sum(1 for k in keys if found[b][k] and not found[a][k])
        both = sum(1 for k in keys if found[a][k] and found[b][k])
        neither = sum(1 for k in keys if not found[a][k] and not found[b][k])
        # exact binomial (McNemar) on the discordant pairs
        n = only_a + only_b
        p = 1.0
        if n:
            from math import comb
            k = min(only_a, only_b)
            p = min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)
        print(f"{a} vs {b}: both {both}, neither {neither}, "
              f"only {a} {only_a}, only {b} {only_b}   exact p={p:.3f}")
    print("\nn = 25 labelled-visible frames over 3 segments of ONE clip. A null")
    print("result here bounds the effect as small, it does not prove it is zero.")

    json.dump({"sweep": results, "bestDthr": best_d,
               "paired": {c: {f"{k[0]}@{k[1]}": v for k, v in found[c].items()}
                          for c in conds}},
              open(args.out, "w"), default=float)
    print("\nwrote", args.out)


if __name__ == "__main__":
    main()
