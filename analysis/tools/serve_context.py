#!/usr/bin/env python3
"""Where are the two players, in court metres, around each rally boundary.

The winner of a squash rally serves the next one (true under both PAR and
English scoring), so "who serves next" is the ground truth for "who won". At
854x480 the serve contact itself is often unreadable, but the SERVE STANCE is
not: the server stands with a foot in a 1.6 m service box while the receiver
waits in the opposite back quarter. Both are positions, and the pipeline
already has a court homography, so the stance can be measured instead of eyeballed.

Court frame (from analyze.py): y = 0 is the FRONT wall, y = COURT_L the back
wall, x = 0 the left wall. Short line at y = SHORT_Y. Service boxes are the two
1.6 m squares just behind the short line against each side wall.

    .venv/bin/python tools/serve_context.py --clip archive_match2 \
        --json eval/serve_context_archive_match2.json

Read-only: reads the existing pose cache, re-runs only tracking (no pose
inference), writes one JSON. Never modifies analyze.py.
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import cv2  # noqa: E402
import analyze as az  # noqa: E402
from rally_end_frames import boundaries  # noqa: E402

BOX = 1.6                      # service box side, metres
STILL_V = 1.2                  # m/s below which a player counts as "set"
V_RALLY = 2.0                  # m/s above which a player is moving at rally pace
HALF_WIN = 0.4                 # s; half-baseline for the smoothed speed
# The court fix drifts: this camera pans and zooms, and at archive_match2
# t=251 a player who is plainly inside the court projects to x=6.4 and gets
# clipped to the side wall. Measured drift is a few tenths of a metre, so the
# service box is dilated before asking whether someone is standing in it.
PAD = 0.6


def box_of(x, y):
    """'L' / 'R' if this court point is inside a (dilated) service box."""
    if not (az.SHORT_Y - PAD <= y <= az.SHORT_Y + BOX + PAD):
        return None
    if x <= BOX + PAD:
        return "L"
    if x >= az.COURT_W - BOX - PAD:
        return "R"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--json", required=True)
    ap.add_argument("--min-gap", type=float, default=3.5)
    args = ap.parse_args()

    corners = json.load(open(os.path.join(ROOT, "samples", f"{args.clip}.corners.json")))["corners"]
    src = np.float32([corners["frontLeft"], corners["frontRight"],
                      corners["backLeft"], corners["backRight"]])
    dst = np.float32([[0, 0], [az.COURT_W, 0], [0, az.COURT_L], [az.COURT_W, az.COURT_L]])
    H_ref2court = cv2.getPerspectiveTransform(src, dst)

    with open(os.path.join(ROOT, "out", f"{args.clip}_v2", "pose_cache_v3.pkl"), "rb") as f:
        blob = pickle.load(f)
    times = blob["times"]
    aligns, _ = az.build_alignments(blob["directs"], blob["steps"])

    tracker = az.TwoTracker()
    pos = []          # per sample: {pid: (x, y)}
    for i, t in enumerate(times):
        tracked = tracker.update(
            az.detect_players(blob["raw_frames"][i], H_ref2court @ aligns[i]), t)
        pos.append({pid: (round(d["court"][0], 2), round(d["court"][1], 2))
                    for pid, d in tracked.items()})

    def speed(pid, i):
        """Net displacement over +/-HALF_WIN seconds, not frame to frame.

        Adjacent-sample speed is useless here: the ankle projection jitters by
        a few tenths of a metre every frame, so a player standing still shows
        0.2 -> 3.5 m/s swings and any "is the rally over" test on it fires on
        noise. Measuring displacement across a ~0.8 s baseline averages the
        jitter out and leaves real locomotion.
        """
        lo = int(np.searchsorted(times, times[i] - HALF_WIN))
        hi = min(int(np.searchsorted(times, times[i] + HALF_WIN)), len(times) - 1)
        while lo < i and pid not in pos[lo]:
            lo += 1
        while hi > i and pid not in pos[hi]:
            hi -= 1
        if lo >= hi or pid not in pos[lo] or pid not in pos[hi]:
            return 0.0
        a, b = pos[lo][pid], pos[hi][pid]
        return float(np.hypot(b[0] - a[0], b[1] - a[1]) / (times[hi] - times[lo]))

    cand = json.load(open(os.path.join(ROOT, "eval", f"candidates_{args.clip}.json")))

    def stop_time(b):
        """Last moment either player was still moving at rally pace.

        Not the last audio onset: the onset stream does NOT go quiet between
        rallies. Every break in archive_match2 contains ungated onsets --
        the 10.9 s break at t=102.6 holds thirteen of them, about one per
        0.8 s -- so "audio went quiet" would be a fiction. Players walking
        between points, though, drop from rally pace to a stroll, and that
        transition is what actually marks the end of the rally.
        """
        lo = int(np.searchsorted(times, b["tA"] - 4.0))
        hi = int(np.searchsorted(times, b["tB"] - 0.5))
        last = None
        for i in range(max(lo, 0), min(hi + 1, len(times))):
            if max((speed(p, i) for p in ("A", "B") if p in pos[i]), default=0) >= V_RALLY:
                last = float(times[i])
        return round(last, 2) if last is not None else round(b["tA"], 2)

    out = []
    for b in boundaries(cand["shotsRaw"], args.min_gap):
        # Scan only the run-up to play resuming. Scanning the whole break
        # scores walking-about as a serve stance: over the 11 s break at
        # archive_match2 t=241 that gave 21 votes to the player who did not
        # serve. tB itself is often a bounce rather than the serve, so the
        # window runs past it.
        lo = int(np.searchsorted(times, b["tB"] - 1.5))
        hi = int(np.searchsorted(times, b["tB"] + 3.0))
        setup = []
        for i in range(lo, min(hi + 1, len(times))):
            row = {"t": round(float(times[i]), 2)}
            for pid in ("A", "B"):
                if pid in pos[i]:
                    x, y = pos[i][pid]
                    row[pid] = {"xy": [x, y], "box": box_of(x, y),
                                "v": round(speed(pid, i), 2)}
            setup.append(row)
        # a serve-stance frame: one player set inside a box, the other behind
        # the short line and on the far side of the mid line
        votes = {"A": 0, "B": 0}
        for row in setup:
            for pid, other in (("A", "B"), ("B", "A")):
                d, o = row.get(pid), row.get(other)
                if not d or not o or d["box"] is None or d["v"] > STILL_V:
                    continue
                if o["xy"][1] < az.SHORT_Y - PAD:
                    continue          # receiver must be behind the short line
                if (d["box"] == "L") == (o["xy"][0] < az.MID_X):
                    continue          # receiver must be on the other side
                votes[pid] += 1
        out.append({**b, "tStop": stop_time(b), "serveStanceFrames": votes,
                    "serverGuess": (max(votes, key=votes.get)
                                    if max(votes.values()) else None),
                    "setup": setup})

    with open(args.json, "w") as f:
        json.dump({"clip": args.clip, "minGap": args.min_gap,
                   "shortLineY": az.SHORT_Y, "courtW": az.COURT_W,
                   "courtL": az.COURT_L, "boundaries": out}, f, indent=1)
    def at(b, t):
        """Compact 'A(x,y)box B(x,y)box' at the sample nearest t."""
        if not b["setup"]:
            return "-"
        r = min(b["setup"], key=lambda r: abs(r["t"] - t))
        parts = []
        for pid in ("A", "B"):
            d = r.get(pid)
            parts.append(f"{pid}({d['xy'][0]:4.1f},{d['xy'][1]:4.1f}){d['box'] or '.'}"
                         if d else f"{pid}(  ?  , ?  ).")
        return " ".join(parts)

    for b in out:
        print(f"b{b['i']:03d} tA={b['tA']:7.2f} tStop={b['tStop']:7.2f} gap={b['gapSec']:5.2f} "
              f"engLast={b['engineLastStriker']} "
              f"votes A={b['serveStanceFrames']['A']:2d} B={b['serveStanceFrames']['B']:2d} "
              f"srv={str(b['serverGuess']):4s} | tB-1 {at(b, b['tB'] - 1.0)} "
              f"| tB+1.5 {at(b, b['tB'] + 1.5)}")


if __name__ == "__main__":
    main()
