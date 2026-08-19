#!/usr/bin/env python3
"""Assemble the hand labels and report visibility with honest uncertainty.

Two things here are deliberate and matter more than the point estimates.

1. THE CLUSTER BOOTSTRAP. Frames inside one 12-frame segment are strongly
   correlated: if the ball is crossing the pale front wall it is visible for a
   dozen frames running, and if the camera is pointed away it is invisible for a
   dozen frames running. Treating 156 frames as 156 independent Bernoulli trials
   would report a CI roughly half its true width. The independent unit is the
   SEGMENT, so the CI is a bootstrap over segments (resample segments with
   replacement, recompute the frame-weighted rate).

2. MEASURED CONTRAST AND SIZE. For every frame labelled visible, this reads the
   actual pixels at the labelled position and measures how much darker the ball
   is than its surroundings, and how many pixels it covers. Those two numbers,
   not the visibility rate, are what tell a detector-builder whether there is
   signal to work with — and they are measured from the ground truth, not from
   any detector.

    .venv/bin/python tools/ball_label_stats.py --labels eval/ball_labels_v1.json
"""
import argparse
import json
import random
from collections import Counter

import cv2
import numpy as np


def load_segments(path):
    """Accepts the assembled label file, or the raw append-only scratch store
    (a concatenation of JSON objects) it is built from."""
    s = open(path).read()
    dec = json.JSONDecoder()
    i, out = 0, []
    while i < len(s):
        while i < len(s) and s[i] in " \n\t\r":
            i += 1
        if i >= len(s):
            break
        o, i = dec.raw_decode(s, i)
        out.extend(o["segments"] if isinstance(o, dict) and "segments" in o
                   else [o])
    return out


def boot_rate(segs, num, den, seed=20260818, iters=10000):
    """Cluster bootstrap over segments. Returns (rate, lo, hi, n_num, n_den)."""
    per = [(sum(1 for f in g["frames"] if num(f, g)),
            sum(1 for f in g["frames"] if den(f, g))) for g in segs]
    per = [p for p in per if p[1] > 0]
    if not per:
        return None
    tot_n = sum(p[0] for p in per)
    tot_d = sum(p[1] for p in per)
    rng = random.Random(seed)
    draws = []
    for _ in range(iters):
        pick = [per[rng.randrange(len(per))] for _ in per]
        d = sum(p[1] for p in pick)
        if d:
            draws.append(sum(p[0] for p in pick) / d)
    draws.sort()
    lo = draws[int(0.025 * len(draws))]
    hi = draws[int(0.975 * len(draws)) - 1]
    return tot_n / tot_d, lo, hi, tot_n, tot_d, len(per)


def measure(segs, video_dir):
    """Contrast and pixel extent of the ball at every visible label."""
    caps, out = {}, []
    for g in segs:
        clip = g["clip"]
        if clip not in caps:
            caps[clip] = cv2.VideoCapture(f"{video_dir}/{clip}.mp4")
        cap = caps[clip]
        want = [f for f in g["frames"] if f["s"] == "visible"]
        if not want:
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, g["startFrame"])
        buf = {}
        for k in range(len(g["frames"])):
            ok, fr = cap.read()
            if not ok:
                break
            buf[g["startFrame"] + k] = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        for f in want:
            im = buf.get(f["f"])
            if im is None:
                continue
            x, y = int(f["x"]), int(f["y"])
            H, W = im.shape
            if not (8 <= x < W - 8 and 8 <= y < H - 8):
                continue
            # Core is 7x7, not 5x5: the labelled centre carries about +/-2 px of
            # ruler-reading error, and a 5x5 core can miss the ball's darkest
            # pixel entirely and report a contrast of zero for a ball that is
            # plainly there.
            win = im[y - 9:y + 10, x - 9:x + 10].astype(np.int16)
            core = im[y - 3:y + 4, x - 3:x + 4].astype(np.int16)
            ring = np.concatenate([win[0, :], win[-1, :], win[:, 0], win[:, -1]])
            bg = float(np.median(ring))
            darkest = float(core.min())
            contrast = bg - darkest
            # Extent needs an absolute floor as well as a relative one: with a
            # relative threshold alone, a faint streak makes the cut-off sit
            # inside the background noise and the "ball" measures 60+ px of wall
            # texture.
            extent = int((win < bg - max(8.0, contrast * 0.5)).sum())
            # Control: the identical statistic at ball-free patches 25-45 px
            # away in the same frame. Without it "the ball is 53 grey levels
            # dark" is unreadable, because the question is not how dark the ball
            # is but how far it stands above the local texture floor that a
            # detector has to reject.
            ctrl = []
            rs = random.Random(f["f"])
            for _ in range(12):
                ang = rs.uniform(0, 6.283)
                rad = rs.uniform(25, 45)
                cxx = int(x + rad * np.cos(ang))
                cyy = int(y + rad * np.sin(ang))
                if not (9 <= cxx < W - 9 and 9 <= cyy < H - 9):
                    continue
                cw = im[cyy - 9:cyy + 10, cxx - 9:cxx + 10].astype(np.int16)
                cc = im[cyy - 3:cyy + 4, cxx - 3:cxx + 4].astype(np.int16)
                cr = np.concatenate([cw[0, :], cw[-1, :], cw[:, 0], cw[:, -1]])
                ctrl.append(float(np.median(cr)) - float(cc.min()))
            out.append({"clip": g["clip"], "f": f["f"], "look": f.get("look"),
                        "bg_class": f.get("bg"), "bgLevel": round(bg, 1),
                        "darkest": darkest, "contrast": round(contrast, 1),
                        "extentPx": extent,
                        "controlContrastMedian": round(float(np.median(ctrl)), 1)
                        if ctrl else None,
                        "controlContrastMax": round(float(np.max(ctrl)), 1)
                        if ctrl else None})
    for c in caps.values():
        c.release()
    return out


def refine(im, x, y, rad=8):
    """Snap a hand label to the darkest-against-its-surround pixel nearby.

    Hand-read positions are only as good as the labeller's eye on a ruler, and
    on faint motion streaks mine drift several pixels. This finds the strongest
    local dark spot within +/-rad and reports it, so the SIZE OF THE SNAP is a
    direct measurement of hand-labelling precision rather than a claim about it.
    Snapping could in principle grab a court line instead of the ball, which is
    why the caller checks whether snapping makes each track more ballistic or
    less: clutter would make it worse.
    """
    H, W = im.shape
    best = None
    for dy in range(-rad, rad + 1):
        for dx in range(-rad, rad + 1):
            cx, cy = x + dx, y + dy
            if not (9 <= cx < W - 9 and 9 <= cy < H - 9):
                continue
            win = im[cy - 9:cy + 10, cx - 9:cx + 10].astype(np.int16)
            ring = np.concatenate([win[0, :], win[-1, :], win[:, 0], win[:, -1]])
            score = float(np.median(ring)) - float(im[cy, cx])
            if best is None or score > best[0]:
                best = (score, cx, cy)
    return best


def jerk(track):
    """Mean |second difference| of a position sequence: how un-ballistic it is.

    Between contacts a squash ball is near-ballistic, so its second difference
    should be small and roughly constant. A track that jumps between unrelated
    dark blobs has a large one.
    """
    if len(track) < 3:
        return None
    d2 = [abs(track[i + 2] - 2 * track[i + 1] + track[i])
          for i in range(len(track) - 2)]
    return float(np.mean(d2))



def refine_report(segs, video_dir):
    """Measure hand-label precision, and check the refinement is not clutter."""
    caps, offs, rows = {}, [], []
    for g in segs:
        clip = g["clip"]
        caps.setdefault(clip, cv2.VideoCapture(f"{video_dir}/{clip}.mp4"))
        cap = caps[clip]
        cap.set(cv2.CAP_PROP_POS_FRAMES, g["startFrame"])
        buf = {}
        for k in range(len(g["frames"])):
            ok, fr = cap.read()
            if not ok:
                break
            buf[g["startFrame"] + k] = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        raw, ref = [], []
        for f in g["frames"]:
            if f["s"] != "visible" or f["f"] not in buf:
                raw.append(None); ref.append(None); continue
            b = refine(buf[f["f"]], int(f["x"]), int(f["y"]))
            if b is None:
                raw.append(None); ref.append(None); continue
            sc, cx, cy = b
            offs.append(((cx - f["x"]) ** 2 + (cy - f["y"]) ** 2) ** 0.5)
            f["xRefined"], f["yRefined"] = cx, cy
            f["contrastRefined"] = round(sc, 1)
            raw.append((f["x"], f["y"])); ref.append((cx, cy))
        # compare smoothness on maximal runs of >=4 consecutive visible frames
        run_r, run_f = [], []
        for a, b in zip(raw, ref):
            if a is None:
                if len(run_r) >= 4:
                    rows.append((run_r, run_f))
                run_r, run_f = [], []
            else:
                run_r.append(a); run_f.append(b)
        if len(run_r) >= 4:
            rows.append((run_r, run_f))
    for c in caps.values():
        c.release()
    jr = [j for r, f in rows for j in
          [jerk([p[0] for p in r]), jerk([p[1] for p in r])] if j is not None]
    jf = [j for r, f in rows for j in
          [jerk([p[0] for p in f]), jerk([p[1] for p in f])] if j is not None]
    return offs, jr, jf, len(rows)


def pct(v):
    return f"{100 * v:.1f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default="eval/ball_labels_v1.json")
    ap.add_argument("--videos", default="samples")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    segs = load_segments(a.labels)
    segs = [g for g in segs if "frames" in g]
    nf = sum(len(g["frames"]) for g in segs)
    print(f"segments {len(segs)}   frames {nf}")

    allf = lambda f, g: True
    vis = lambda f, g: f["s"] == "visible"
    # "fair test": the ball is in flight AND inside the frame. Dead-ball
    # stretches and frames where the camera is not pointed at the play are not
    # tests of whether a 3 px ball is resolvable.
    fair = lambda f, g: (g.get("inFlight") is not False
                         and f.get("miss") not in ("offFrame", "cameraOffTarget",
                                                   "noBallInFlight"))

    rows = [
        ("ALL sampled in-rally frames", vis, allf),
        ("ball in flight AND in shot", vis, fair),
    ]
    report = {}
    for name, num, den in rows:
        r = boot_rate(segs, num, den)
        if not r:
            continue
        rate, lo, hi, n, d, k = r
        print(f"{name:34s} {n:4d}/{d:4d} = {pct(rate)}  "
              f"95% CI [{pct(lo)}, {pct(hi)}]  ({k} segments)")
        report[name] = {"visible": n, "of": d, "rate": round(rate, 4),
                        "ci95": [round(lo, 4), round(hi, 4)], "segments": k}

    print("\nper clip (all sampled frames)")
    for clip in sorted({g["clip"] for g in segs}):
        sub = [g for g in segs if g["clip"] == clip]
        r = boot_rate(sub, vis, allf)
        rate, lo, hi, n, d, k = r
        print(f"  {clip:16s} {n:3d}/{d:3d} = {pct(rate):>6s}  "
              f"CI [{pct(lo)}, {pct(hi)}]  ({k} segs)")
        report.setdefault("perClip", {})[clip] = {
            "visible": n, "of": d, "rate": round(rate, 4),
            "ci95": [round(lo, 4), round(hi, 4)], "segments": k}

    miss = Counter(f["miss"] for g in segs for f in g["frames"]
                   if f["s"] != "visible" and f.get("miss"))
    print("\nwhy the ball was not visible (frames)")
    for k, v in miss.most_common():
        print(f"  {k:28s} {v:4d}")
    report["missReasons"] = dict(miss)

    look = Counter(f["look"] for g in segs for f in g["frames"]
                   if f["s"] == "visible" and f.get("look"))
    print("\nappearance when visible", dict(look))
    report["appearance"] = dict(look)

    bgc = Counter(f["bg"] for g in segs for f in g["frames"]
                  if f["s"] == "visible" and f.get("bg"))
    print("background when visible", dict(bgc))
    report["backgroundWhenVisible"] = dict(bgc)

    m = measure(segs, a.videos)
    if m:
        con = np.array([r["contrast"] for r in m])
        ext = np.array([r["extentPx"] for r in m])
        print(f"\nmeasured at {len(m)} visible labels")
        print(f"  contrast (grey levels below local background): "
              f"median {np.median(con):.0f}  IQR {np.percentile(con, 25):.0f}"
              f"-{np.percentile(con, 75):.0f}  min {con.min():.0f} "
              f"max {con.max():.0f}")
        print(f"  extent (px darker than halfway):  median {np.median(ext):.0f}"
              f"  IQR {np.percentile(ext, 25):.0f}-{np.percentile(ext, 75):.0f}"
              f"  min {ext.min()} max {ext.max()}")
        ctl = np.array([r["controlContrastMedian"] for r in m
                        if r["controlContrastMedian"] is not None])
        ctlmax = np.array([r["controlContrastMax"] for r in m
                           if r["controlContrastMax"] is not None])
        print(f"  CONTROL, same statistic on ball-free patches 25-45 px away:"
              f" median {np.median(ctl):.0f}  (worst patch per frame, median "
              f"{np.median(ctlmax):.0f})")
        beats = sum(1 for r in m if r["controlContrastMax"] is not None
                    and r["contrast"] > r["controlContrastMax"])
        print(f"  ball darker than EVERY control patch in its own frame: "
              f"{beats}/{len(m)} = {pct(beats / len(m))}")
        weak = sorted(m, key=lambda r: r["contrast"])[:6]
        print("  weakest labelled balls (contrast, extent, background):")
        for r in weak:
            print(f"    {r['clip']} f{r['f']:<6d} {r['look']:7s} "
                  f"contrast {r['contrast']:5.1f}  extent {r['extentPx']:3d}  "
                  f"bg {r['bg_class']}")
        for lk in sorted({r["look"] for r in m if r["look"]}):
            c = np.array([r["contrast"] for r in m if r["look"] == lk])
            e = np.array([r["extentPx"] for r in m if r["look"] == lk])
            print(f"  {lk:7s} n={len(c):3d}  contrast median {np.median(c):.0f}"
                  f"   extent median {np.median(e):.0f}")
        report["measured"] = {
            "n": len(m),
            "contrastMedian": float(np.median(con)),
            "contrastIQR": [float(np.percentile(con, 25)),
                            float(np.percentile(con, 75))],
            "contrastMin": float(con.min()), "contrastMax": float(con.max()),
            "extentMedian": float(np.median(ext)),
            "extentIQR": [float(np.percentile(ext, 25)),
                          float(np.percentile(ext, 75))],
            "perLook": {lk: {
                "n": int(sum(1 for r in m if r["look"] == lk)),
                "contrastMedian": float(np.median(
                    [r["contrast"] for r in m if r["look"] == lk])),
                "extentMedian": float(np.median(
                    [r["extentPx"] for r in m if r["look"] == lk]))}
                for lk in sorted({r["look"] for r in m if r["look"]})},
        }
        report["measurements"] = m

    offs, jr, jf, nruns = refine_report(segs, a.videos)
    if offs:
        o = np.array(offs)
        print(f"\nHAND-LABEL PRECISION ({len(o)} visible labels)")
        print(f"  distance from my label to the strongest local dark spot: "
              f"median {np.median(o):.1f} px  90th pct {np.percentile(o, 90):.1f}"
              f" px  max {o.max():.1f} px")
        print(f"  ballistic check on {nruns} runs of >=4 consecutive visible "
              f"frames, mean |2nd difference| px/frame^2:")
        print(f"    as hand-labelled {np.mean(jr):.2f}   after snapping "
              f"{np.mean(jf):.2f}   ({'snapping helps' if np.mean(jf) < np.mean(jr) else 'snapping HURTS - treat refined positions as unsafe'})")
        report["labelPrecision"] = {
            "n": len(o), "offsetMedianPx": float(np.median(o)),
            "offsetP90Px": float(np.percentile(o, 90)),
            "offsetMaxPx": float(o.max()),
            "ballisticRuns": nruns,
            "meanAbsSecondDiffRaw": float(np.mean(jr)),
            "meanAbsSecondDiffRefined": float(np.mean(jf))}

    if a.out:
        json.dump(report, open(a.out, "w"), indent=1)
        print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
