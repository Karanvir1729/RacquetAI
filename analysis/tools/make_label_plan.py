#!/usr/bin/env python3
"""Draw the (seeded, reproducible) sample of moments to hand-label.

Two pools, because precision and recall need different sampling:

  windows  -- contiguous stretches of video, chosen uniformly at random, that
              get labelled EXHAUSTIVELY (every real racquet-ball contact in
              them is written down, whether or not the detector fired). These
              are the only thing that can measure recall, and because the
              windows are random the detector candidates inside them also give
              an unbiased precision estimate.
  moments  -- extra detector candidates sampled uniformly at random from
              OUTSIDE the windows, to widen the precision sample across the
              whole clip at low cost.

    .venv/bin/python tools/make_label_plan.py --json eval/sampling_plan.json
"""
import argparse
import json
import os
import random

CLIPS = ("archive_match2", "archive_match3", "archive_match4")
N_WINDOWS = 2
WINDOW_S = 9.6          # 6 filmstrips of 8 frames at 0.2 s
N_MOMENTS = 12          # extra detector candidates per clip
EDGE_S = 20.0           # keep windows away from the very start/end


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evaldir", default=os.path.join(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))), "eval"))
    ap.add_argument("--json", required=True)
    ap.add_argument("--seed", type=int, default=20260818)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    plan = {"seed": args.seed, "windowSec": WINDOW_S, "clips": {}}
    for clip in CLIPS:
        cand = json.load(open(os.path.join(args.evaldir, f"candidates_{clip}.json")))
        dur = cand["durationSec"]
        wins = []
        while len(wins) < N_WINDOWS:
            t0 = round(rng.uniform(EDGE_S, dur - EDGE_S - WINDOW_S), 2)
            if all(abs(t0 - w) > 2 * WINDOW_S for w in wins):
                wins.append(t0)
        wins.sort()
        in_win = lambda t: any(w - 0.5 <= t <= w + WINDOW_S + 0.5 for w in wins)  # noqa: E731
        outside = [s["t"] for s in cand["shotsRaw"] if not in_win(s["t"])]
        moments = sorted(rng.sample(outside, min(N_MOMENTS, len(outside))))
        plan["clips"][clip] = {
            "durationSec": dur,
            "windows": wins,
            "moments": moments,
            "nCandidatesInWindows": sum(1 for s in cand["shotsRaw"] if in_win(s["t"])),
        }
    with open(args.json, "w") as f:
        json.dump(plan, f, indent=1)
    print(json.dumps(plan, indent=1))


if __name__ == "__main__":
    main()
