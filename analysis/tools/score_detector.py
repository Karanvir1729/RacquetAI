#!/usr/bin/env python3
"""Score a shot detector against the hand labels in analysis/eval/labels_v1.json.

Precision and recall are measured on different pools, because they need
different sampling (see tools/make_label_plan.py):

  RECALL   - only inside the exhaustive windows, where every real strike was
             written down. A ground-truth contact counts as found if a detector
             shot lands within +/-TOL of it (greedy nearest, one-to-one, so a
             second onset inside the same stroke cannot rescue a second contact).
  PRECISION- every hand-labelled candidate: the ones inside the windows (scored
             by the same one-to-one matching, so duplicate onsets inside one
             stroke are counted as false positives) plus the extra candidates
             sampled at random from the rest of each clip (scored by their
             hand verdict).

`low` confidence labels are excluded from both, and counted separately.

    .venv/bin/python tools/score_detector.py     # the current detector
    .venv/bin/python tools/score_detector.py \
        --pred-pattern 'eval/candidates_baseline_{clip}.json'   # before the rally gate

--pred-pattern takes any JSON with a `shotsRaw` list of {t, player} (the shape
tools/dump_candidates.py writes), keyed per clip.
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOL = 0.3
GOOD = ("high", "med")


def load_pred(pattern, clip):
    with open(os.path.join(ROOT, pattern.format(clip=clip))) as f:
        d = json.load(f)
    return sorted(d["shotsRaw"], key=lambda s: s["t"]), d


def match(pred_ts, gt_ts, tol=TOL):
    """Greedy one-to-one nearest matching. Returns {gt_index: pred_index}."""
    pairs = sorted(((abs(p - g), gi, pi) for gi, g in enumerate(gt_ts)
                    for pi, p in enumerate(pred_ts) if abs(p - g) <= tol))
    used_g, used_p, out = set(), set(), {}
    for _, gi, pi in pairs:
        if gi in used_g or pi in used_p:
            continue
        used_g.add(gi)
        used_p.add(pi)
        out[gi] = pi
    return out


def pct(a, b):
    return f"{100.0 * a / b:5.1f}% ({a}/{b})" if b else "    n/a (0)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(ROOT, "eval", "labels_v1.json"))
    ap.add_argument("--pred-pattern", default="eval/candidates_{clip}.json")
    ap.add_argument("--tol", type=float, default=TOL)
    ap.add_argument("--json", help="write the metrics here as JSON too")
    args = ap.parse_args()

    lab = json.load(open(args.labels))
    clips = sorted({w["clip"] for w in lab["exhaustiveWindows"]} |
                   {c["clip"] for c in lab["candidateLabels"]})

    report = {"tolSec": args.tol, "clips": {}, "pooled": {}}
    tot = dict(tp=0, fp=0, gt=0, found=0, onsetFound=0, lowCand=0, lowGt=0,
               attrOk=0, attrN=0, winSec=0.0, predAll=0)
    lines = []

    for clip in clips:
        pred, blob = load_pred(args.pred_pattern, clip)
        onsets = blob.get("onsets", [])
        wins = [w for w in lab["exhaustiveWindows"] if w["clip"] == clip]
        gt = [c for c in lab["contacts"] if c["clip"] == clip]
        cands = [c for c in lab["candidateLabels"] if c["clip"] == clip]
        in_win = lambda t: any(w["t0"] <= t <= w["t1"] for w in wins)  # noqa: E731

        gt_w = [c for c in gt if in_win(c["t"]) and c["conf"] in GOOD]
        gt_low = [c for c in gt if in_win(c["t"]) and c["conf"] == "low"]
        pred_w = [s for s in pred if in_win(s["t"])]
        m = match([s["t"] for s in pred_w], [c["t"] for c in gt_w], args.tol)
        found = len(m)
        # a contact is "reachable" if ANY audio onset (gated or not) is near it
        m_on = match([t for t in onsets if in_win(t)], [c["t"] for c in gt_w], args.tol)

        # precision inside the windows: matched predictions are TPs, the rest FPs.
        # Predictions whose only hand label is `low` are dropped from the count.
        low_t = {round(c["t"], 3) for c in cands if c["conf"] == "low"}
        matched_pred = set(m.values())
        tp_w = fp_w = low_w = 0
        for i, s in enumerate(pred_w):
            if round(s["t"], 3) in low_t:
                low_w += 1
            elif i in matched_pred:
                tp_w += 1
            else:
                fp_w += 1
        # Candidates sampled outside the windows: use the hand verdict directly,
        # but ONLY for the ones this detector still emits. The labelled set was
        # sampled from the baseline's output, so counting every label here
        # regardless of `pred` (as this scorer first did) silently credits a new
        # detector with false positives it no longer produces — the baseline is
        # unaffected, since it emits all of them by construction, but any
        # tightening of the gate was being scored as if nothing had changed.
        out_c = [c for c in cands if not in_win(c["t"])]
        pred_o = [s["t"] for s in pred if not in_win(s["t"])]
        emitted = match(pred_o, [c["t"] for c in out_c], args.tol)
        out_c = [c for gi, c in enumerate(out_c) if gi in emitted]
        tp_o = sum(1 for c in out_c if c["conf"] in GOOD and c["contact"])
        fp_o = sum(1 for c in out_c if c["conf"] in GOOD and not c["contact"])
        low_o = sum(1 for c in out_c if c["conf"] == "low")

        # striker attribution on the matched pairs (indicative only)
        ok = n = 0
        for gi, pi in m.items():
            box = gt_w[gi].get("strikerBox")
            if box in ("A", "B"):
                n += 1
                ok += int(pred_w[pi]["player"] == box)

        win_s = sum(w["t1"] - w["t0"] for w in wins)
        report["clips"][clip] = {
            "windows": len(wins), "windowSec": round(win_s, 1),
            "gtContacts": len(gt_w), "gtLowExcluded": len(gt_low),
            "found": found, "recall": round(found / len(gt_w), 3) if gt_w else None,
            "onsetReachable": len(m_on),
            "onsetRecall": round(len(m_on) / len(gt_w), 3) if gt_w else None,
            "candIn": tp_w + fp_w, "tpIn": tp_w, "fpIn": fp_w,
            "candOut": tp_o + fp_o, "tpOut": tp_o, "fpOut": fp_o,
            "lowExcluded": low_w + low_o,
            "precision": round((tp_w + tp_o) / (tp_w + fp_w + tp_o + fp_o), 3)
                         if (tp_w + fp_w + tp_o + fp_o) else None,
            "attributionOnTP": round(ok / n, 3) if n else None,
            "predTotal": len(pred),
        }
        lines.append(f"{clip}: precision {pct(tp_w + tp_o, tp_w + fp_w + tp_o + fp_o)}   "
                     f"recall {pct(found, len(gt_w))}   "
                     f"onset-stage recall {pct(len(m_on), len(gt_w))}")
        tot["tp"] += tp_w + tp_o
        tot["fp"] += fp_w + fp_o
        tot["gt"] += len(gt_w)
        tot["found"] += found
        tot["onsetFound"] += len(m_on)
        tot["lowCand"] += low_w + low_o
        tot["lowGt"] += len(gt_low)
        tot["attrOk"] += ok
        tot["attrN"] += n
        tot["winSec"] += win_s
        tot["predAll"] += len(pred)

    p, r = tot["tp"] + tot["fp"], tot["gt"]
    report["pooled"] = {
        "labelledCandidates": p, "tp": tot["tp"], "fp": tot["fp"],
        "precision": round(tot["tp"] / p, 3) if p else None,
        "gtContacts": r, "found": tot["found"],
        "recall": round(tot["found"] / r, 3) if r else None,
        "onsetRecall": round(tot["onsetFound"] / r, 3) if r else None,
        "f1": round(2 * tot["tp"] / p * tot["found"] / r /
                    (tot["tp"] / p + tot["found"] / r), 3) if p and r else None,
        "lowConfExcluded": {"candidates": tot["lowCand"], "contacts": tot["lowGt"]},
        "attributionOnTP": round(tot["attrOk"] / tot["attrN"], 3) if tot["attrN"] else None,
        "exhaustiveWindowSec": round(tot["winSec"], 1),
        "detectorShotsAllClips": tot["predAll"],
    }
    print("\n".join(lines))
    print("-" * 72)
    print(f"POOLED: precision {pct(tot['tp'], p)}   recall {pct(tot['found'], r)}   "
          f"onset-stage recall {pct(tot['onsetFound'], r)}")
    print(f"        f1 {report['pooled']['f1']}   "
          f"striker attribution on true positives {pct(tot['attrOk'], tot['attrN'])}")
    print(f"        excluded as low confidence: {tot['lowCand']} candidates, "
          f"{tot['lowGt']} contacts; exhaustive video labelled {tot['winSec']:.1f} s")
    if args.json:
        with open(args.json, "w") as f:
            json.dump(report, f, indent=1)
        print(f"        metrics -> {args.json}")


if __name__ == "__main__":
    main()
