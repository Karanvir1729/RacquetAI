#!/usr/bin/env python3
"""What the CURRENT knob can buy: precision/recall vs the wrist-peak gate.

Re-scores the hand labels while pretending WRIST_PEAK_GATE had a different
value. Only tightening can be simulated (loosening would need labels for onsets
the present gate already threw away), which is exactly the question worth
asking: can the existing player-activity gate be tuned out of the false-positive
problem, or does the fix need a new signal?

    .venv/bin/python tools/gate_sweep.py
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOD = ("high", "med")
CLIPS = ("archive_match2", "archive_match3", "archive_match4")


def match(pred, gt, tol):
    pairs = sorted((abs(p - g), gi, pi) for gi, g in enumerate(gt)
                   for pi, p in enumerate(pred) if abs(p - g) <= tol)
    ug, up, out = set(), set(), {}
    for _, gi, pi in pairs:
        if gi in ug or pi in up:
            continue
        ug.add(gi)
        up.add(pi)
        out[gi] = pi
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(ROOT, "eval", "labels_v1.json"))
    ap.add_argument("--tol", type=float, default=0.3)
    ap.add_argument("--gates", default="1.9,2.2,2.5,3.0,3.5,4.0,5.0")
    ap.add_argument("--pred-pattern", default="eval/candidates_baseline_{clip}.json",
                    help="the pre-rally-gate detector by default: this tool exists to "
                         "show what the OLD knob alone could buy")
    args = ap.parse_args()
    lab = json.load(open(args.labels))
    data = {c: json.load(open(os.path.join(ROOT, args.pred_pattern.format(clip=c))))
            for c in CLIPS}

    print(f"{'gate':>6} {'precision':>17} {'recall':>16}")
    for thr in [float(x) for x in args.gates.split(",")]:
        tp = fp = found = gtn = 0
        for c in CLIPS:
            wins = [w for w in lab["exhaustiveWindows"] if w["clip"] == c]
            inw = lambda t: any(w["t0"] <= t <= w["t1"] for w in wins)  # noqa: E731
            keep = [x for x in data[c]["candidates"]
                    if x["passed"] and max(x["travA"], x["travB"]) >= thr]
            low = {round(x["t"], 3) for x in lab["candidateLabels"]
                   if x["clip"] == c and x["conf"] == "low"}
            gt = [x for x in lab["contacts"]
                  if x["clip"] == c and inw(x["t"]) and x["conf"] in GOOD]
            pw = [x for x in keep if inw(x["t"])]
            m = match([x["t"] for x in pw], [x["t"] for x in gt], args.tol)
            found += len(m)
            gtn += len(gt)
            hit = set(m.values())
            for i, x in enumerate(pw):
                if round(x["t"], 3) in low:
                    continue
                tp += i in hit
                fp += i not in hit
            byt = {round(x["t"], 3): x for x in lab["candidateLabels"]
                   if x["clip"] == c and not inw(x["t"])}
            for x in keep:
                h = byt.get(round(x["t"], 3))
                if h and h["conf"] in GOOD:
                    tp += h["contact"]
                    fp += not h["contact"]
        print(f"{thr:6.1f} {100 * tp / max(tp + fp, 1):10.1f}% ({tp:2d}/{tp + fp:2d})"
              f" {100 * found / max(gtn, 1):10.1f}% ({found}/{gtn})")


if __name__ == "__main__":
    main()
