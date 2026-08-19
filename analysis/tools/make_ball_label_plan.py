#!/usr/bin/env python3
"""Seeded sample of short in-play segments to hand-label the ball in.

Why segments and not scattered single frames: a 3 px ball is found by its
motion, so a labeller must see consecutive frames. Why SHORT segments and many
of them: frames inside one segment are strongly correlated (a ball crossing the
front wall is visible for a dozen frames in a row), so the honest unit of
independence is the SEGMENT, not the frame. 21 segments x 12 frames gives 252
frames but only 21 independent clusters, and the visibility rate must be
reported with a cluster bootstrap over segments rather than a binomial CI over
frames — which would claim roughly twice the precision the data supports.

Segments are drawn from inside rally intervals (eval/breaks_v1.json), because
in-play ball visibility is the quantity of interest; a between-rallies frame has
no ball in flight to see. Draws are duration-weighted so long rallies are not
over-represented per unit of footage, and are separated by >= 2 s so no two
segments watch the same flight.

    .venv/bin/python tools/make_ball_label_plan.py > eval/ball_sampling_plan.json
"""
import json
import random

BREAKS = "eval/breaks_v1.json"
SEED = 20260818          # same day-seed as eval/sampling_plan.json ...
SALT = "ball-groundtruth"  # ... salted so the draws are a fresh, disjoint sample
SEGS_PER_CLIP = 7
SEG_FRAMES = 12
FPS = 29.97
MIN_RALLY_SEC = 3.0
MIN_SEP_SEC = 2.0
EDGE_PAD_START = 0.5     # skip the serve wind-up
EDGE_PAD_END = 1.0       # keep the whole segment inside the rally


def main():
    breaks = json.load(open(BREAKS))
    plan = {
        "seed": SEED,
        "salt": SALT,
        "segFrames": SEG_FRAMES,
        "fps": FPS,
        "source": BREAKS,
        "unitOfIndependence": "segment (frames within a segment are correlated)",
        "clips": {},
    }
    for clip in sorted(breaks["clips"]):
        rng = random.Random(f"{SEED}:{SALT}:{clip}")
        rallies = [r for r in breaks["clips"][clip]
                   if r["tA"] - r["rallyStart"] >= MIN_RALLY_SEC]
        spans = [(r["rallyStart"] + EDGE_PAD_START, r["tA"] - EDGE_PAD_END, r["i"])
                 for r in rallies]
        spans = [s for s in spans if s[1] - s[0] > SEG_FRAMES / FPS]
        weights = [s[1] - s[0] for s in spans]
        picked = []
        for _ in range(4000):
            if len(picked) == SEGS_PER_CLIP:
                break
            lo, hi, ri = rng.choices(spans, weights=weights, k=1)[0]
            t = rng.uniform(lo, hi - SEG_FRAMES / FPS)
            if any(abs(t - p["tSec"]) < MIN_SEP_SEC for p in picked):
                continue
            picked.append({"tSec": round(t, 3), "rally": ri,
                           "startFrame": int(round(t * FPS)),
                           "endFrame": int(round(t * FPS)) + SEG_FRAMES - 1})
        picked.sort(key=lambda p: p["tSec"])
        for k, p in enumerate(picked):
            p["seg"] = f"{clip}#{k}"
        plan["clips"][clip] = {"nRalliesEligible": len(spans), "segments": picked}
    print(json.dumps(plan, indent=1))


if __name__ == "__main__":
    main()
