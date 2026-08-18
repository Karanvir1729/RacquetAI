#!/usr/bin/env python3
"""Score "the last player to strike the ball won the rally" against hand labels.

    .venv/bin/python tools/score_last_striker.py --labels eval/rally_labels_v1.json

Reports the ORACLE accuracy: given the true last striker, how often was the
true last striker also the winner. This is the ceiling for a live referee --
it assumes the phone identifies the last striker perfectly, which it does not.
Anything the shipped detector does can only be worse.

Wilson score interval rather than the normal approximation, because n is small
and the normal interval is badly wrong at the edges for n of this size.
"""
import argparse
import json
import math
from collections import Counter


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", required=True)
    args = ap.parse_args()
    blob = json.load(open(args.labels))
    rows = blob["labels"]

    inspected = len(rows)
    not_end = [r for r in rows if not r["realRallyEnd"]]
    ends = [r for r in rows if r["realRallyEnd"]]
    scorable = [r for r in ends if r["correct"] is not None]
    unscorable = [r for r in ends if r["correct"] is None]
    k = sum(1 for r in scorable if r["correct"])
    n = len(scorable)
    lo, hi = wilson(k, n)

    print(f"breaks inspected                  {inspected}")
    print(f"  not a rally end at all          {len(not_end)}")
    print(f"  real rally end                  {len(ends)}")
    print(f"    scorable (both ends readable) {n}")
    print(f"    unscorable                    {len(unscorable)}"
          f"  ({', '.join(sorted({('no server' if r['nextServer'] is None else 'no striker') for r in unscorable}))})")
    print()
    print(f"ORACLE 'last striker won'         {k}/{n} = {k / n:.1%}"
          if n else "no scorable rows")
    print(f"  95% Wilson interval             [{lo:.1%}, {hi:.1%}]")
    print()

    hi_conf = [r for r in scorable if r["confidence"] in ("high", "medium")]
    kh = sum(1 for r in hi_conf if r["correct"])
    if hi_conf:
        l2, h2 = wilson(kh, len(hi_conf))
        print(f"  dropping low-confidence labels  {kh}/{len(hi_conf)} = "
              f"{kh / len(hi_conf):.1%}  [{l2:.1%}, {h2:.1%}]")
    print()

    print("per clip")
    for clip in sorted({r["clip"] for r in scorable}):
        sub = [r for r in scorable if r["clip"] == clip]
        print(f"  {clip:18s} {sum(1 for r in sub if r['correct'])}/{len(sub)}")
    print()

    print("the failures")
    for r in scorable:
        if not r["correct"]:
            print(f"  {r['clip']} b{r['i']:02d} t={r['tA']:.2f} "
                  f"last={r['lastStriker']} won={r['nextServer']} "
                  f"({r['confidence']}) {r['note']}")
    print()
    kinds = Counter(r["lastShotKind"] for r in scorable if not r["correct"])
    print(f"last shot on the failures: {dict(kinds)}")
    print("tin vs out: NOT MEASURED -- see reasonGroundTruth in the labels file.")


if __name__ == "__main__":
    main()
