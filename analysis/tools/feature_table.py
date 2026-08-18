#!/usr/bin/env python3
"""Join eval/features_<clip>.json to the hand labels and print separability.

Label assignment per onset:
  inside an exhaustive window  - positive if it is the greedy-nearest onset to a
                                 high/med ground-truth contact (<=0.3 s), else
                                 negative. Onsets within 0.3 s of a *low*
                                 confidence contact, or carrying a low candidate
                                 label, are dropped.
  outside the windows          - only the hand-labelled candidates are usable.

That is the only place the windows' exhaustiveness is spent: it turns every
unmatched in-window onset into a genuine negative, which is where most of the
training signal lives.
"""
import json
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = ("archive_match2", "archive_match3", "archive_match4")
GOOD = ("high", "med")
TOL = 0.3


def greedy(pred_ts, gt_ts, tol=TOL):
    pairs = sorted((abs(p - g), gi, pi) for gi, g in enumerate(gt_ts)
                   for pi, p in enumerate(pred_ts) if abs(p - g) <= tol)
    ug, up, out = set(), set(), {}
    for _, gi, pi in pairs:
        if gi in ug or pi in up:
            continue
        ug.add(gi)
        up.add(pi)
        out[gi] = pi
    return out


def load(clip, labels=None):
    lab = labels or json.load(open(os.path.join(ROOT, "eval", "labels_v1.json")))
    feats = json.load(open(os.path.join(ROOT, "eval", f"features_{clip}.json")))["onsets"]
    wins = [w for w in lab["exhaustiveWindows"] if w["clip"] == clip]
    inw = lambda t: any(w["t0"] <= t <= w["t1"] for w in wins)  # noqa: E731
    gt = [c for c in lab["contacts"] if c["clip"] == clip and inw(c["t"])]
    gt_good = [c for c in gt if c["conf"] in GOOD]
    gt_low = [c for c in gt if c["conf"] == "low"]
    cands = {round(c["t"], 3): c for c in lab["candidateLabels"] if c["clip"] == clip}

    idx_in = [i for i, r in enumerate(feats) if inw(r["t"])]
    m = greedy([feats[i]["t"] for i in idx_in], [c["t"] for c in gt_good])
    matched = {idx_in[pi]: gi for gi, pi in m.items()}

    rows = []
    for i, r in enumerate(feats):
        y, src, note = None, None, ""
        if inw(r["t"]):
            if i in matched:
                y, src = 1, "win"
                note = gt_good[matched[i]].get("reason", "strike")
            elif any(abs(r["t"] - c["t"]) <= TOL for c in gt_low):
                y, src = None, "win-low"
            else:
                y, src = 0, "win"
                h = cands.get(round(r["t"], 3))
                note = (h or {}).get("reason", "")
                if h and h["conf"] == "low":
                    y, src = None, "win-lowcand"
        else:
            h = cands.get(round(r["t"], 3))
            if h and h["conf"] in GOOD:
                y, src = int(h["contact"]), "out"
                note = h.get("reason", "")
            elif h:
                y, src = None, "out-low"
        rows.append({"clip": clip, "i": i, "t": r["t"], "y": y, "src": src,
                     "note": note, "f": r})
    return rows


def all_rows(labels=None):
    out = []
    for c in CLIPS:
        out += load(c, labels)
    return out


AUDIO_KEYS = ["promDb", "peakDb", "attackMs", "decayMs", "decay20Ms", "centroid",
              "roll85", "roll95", "flat", "tail60", "b0", "b1", "b2", "b3", "b4",
              "tPeak"]


def kin_feats(r):
    """Derived kinematics for one onset record."""
    out = {}
    for p in ("A", "B"):
        w = r["kin"][p]["w"]
        if w:
            dts = np.array([x[0] for x in w])
            vs = np.array([x[1] for x in w])
            k = int(np.argmax(vs))
            near = vs[(dts >= -0.30) & (dts <= 0.30)]
            pre = vs[(dts >= -0.70) & (dts < -0.30)]
            post = vs[(dts > 0.30) & (dts <= 0.70)]
            far = np.concatenate([pre, post]) if len(pre) + len(post) else np.array([0.0])
            out[f"pk{p}"] = float(near.max()) if len(near) else 0.0
            out[f"pkT{p}"] = float(dts[k])
            out[f"far{p}"] = float(np.median(far))
            out[f"burst{p}"] = out[f"pk{p}"] / max(float(np.median(far)), 0.25)
            out[f"n{p}"] = len(w)
        else:
            out.update({f"pk{p}": 0.0, f"pkT{p}": 9.0, f"far{p}": 0.0,
                        f"burst{p}": 0.0, f"n{p}": 0})
        out[f"trav{p}"] = r["kin"][p]["travel"]
        out[f"cpk{p}"] = r["kin"][p]["courtPeak"]
    out["pkMax"] = max(out["pkA"], out["pkB"])
    out["burstMax"] = max(out["burstA"], out["burstB"])
    out["sep"] = r["sep"] if r["sep"] is not None else -1
    out["prevDt"] = r["prevDt"]
    out["nextDt"] = r["nextDt"]
    out["nIn3s"] = r["nIn3s"]
    return out


def feat_vec(r):
    d = dict(kin_feats(r))
    a = r["audio"] or {}
    for k in AUDIO_KEYS:
        d["a_" + k] = a.get(k, 0.0)
    d["a_hf"] = (a.get("b3", 0.0) + a.get("b4", 0.0))
    d["a_lf"] = a.get("b0", 0.0)
    return d


def main():
    rows = all_rows()
    pos = [r for r in rows if r["y"] == 1]
    neg = [r for r in rows if r["y"] == 0]
    print(f"labelled onsets: {len(pos)} positive, {len(neg)} negative "
          f"(dropped {sum(1 for r in rows if r['y'] is None and r['src'])} low-conf, "
          f"{sum(1 for r in rows if r['y'] is None and not r['src'])} unlabelled)")
    for c in CLIPS:
        print(f"  {c}: pos {sum(1 for r in pos if r['clip'] == c)} "
              f"neg {sum(1 for r in neg if r['clip'] == c)} "
              f"(in-window neg {sum(1 for r in neg if r['clip'] == c and r['src'] == 'win')})")

    P = [feat_vec(r["f"]) for r in pos]
    N = [feat_vec(r["f"]) for r in neg]
    keys = sorted(P[0].keys())
    print(f"\n{'feature':>14} {'pos med':>9} {'neg med':>9} {'pos p10':>9} "
          f"{'neg p90':>9} {'AUC':>6}")
    scored = []
    for k in keys:
        p = np.array([x[k] for x in P], float)
        n = np.array([x[k] for x in N], float)
        # AUC via rank statistic
        allv = np.concatenate([p, n])
        ranks = np.argsort(np.argsort(allv)) + 1
        auc = (ranks[:len(p)].sum() - len(p) * (len(p) + 1) / 2) / (len(p) * len(n))
        scored.append((abs(auc - 0.5), k, np.median(p), np.median(n),
                       np.percentile(p, 10), np.percentile(n, 90), auc))
    for _, k, pm, nm, pp, np90, auc in sorted(scored, reverse=True):
        print(f"{k:>14} {pm:9.3f} {nm:9.3f} {pp:9.3f} {np90:9.3f} {auc:6.3f}")


if __name__ == "__main__":
    main()
