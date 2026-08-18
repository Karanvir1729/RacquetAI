#!/usr/bin/env python3
"""Dump per-sample-time pixel boxes for the tracked players A and B.

Read-only over the existing pose cache (no pose inference, no analyze.py
changes). Used by tools/eval_frames.py to (a) crop labelling montages tightly
around the action and (b) draw who the engine thinks A and B are, so a human
label can name the striker in the engine's own ID space.

    .venv/bin/python tools/player_boxes.py --video samples/archive_match2.mp4 \
        --corners samples/archive_match2.corners.json --out out/archive_match2_v2 \
        --json eval/boxes_archive_match2.json
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cv2  # noqa: E402
import analyze as az  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--json", required=True)
    args = ap.parse_args()

    corners = json.load(open(args.corners))["corners"]
    src = np.float32([corners["frontLeft"], corners["frontRight"],
                      corners["backLeft"], corners["backRight"]])
    dst = np.float32([[0, 0], [az.COURT_W, 0], [0, az.COURT_L], [az.COURT_W, az.COURT_L]])
    H_ref2court = cv2.getPerspectiveTransform(src, dst)

    with open(os.path.join(args.out, "pose_cache_v3.pkl"), "rb") as f:
        blob = pickle.load(f)
    times, raw_frames = blob["times"], blob["raw_frames"]
    aligns, _ = az.build_alignments(blob["directs"], blob["steps"])

    tracker = az.TwoTracker()
    rows = []
    for i, t in enumerate(times):
        tracked = tracker.update(az.detect_players(raw_frames[i], H_ref2court @ aligns[i]), t)
        row = {}
        for pid, d in tracked.items():
            k, s = d["kpts"], d["scores"]
            vis = k[s > az.KPT_CONF]
            if len(vis) < 6:
                continue
            row[pid] = [round(float(vis[:, 0].min()), 1), round(float(vis[:, 1].min()), 1),
                        round(float(vis[:, 0].max()), 1), round(float(vis[:, 1].max()), 1)]
        rows.append(row)

    with open(args.json, "w") as f:
        json.dump({"times": [round(float(t), 3) for t in times], "players": rows}, f)
    print(f"{args.json}: {sum(1 for r in rows if len(r) == 2)}/{len(rows)} frames with both players")


if __name__ == "__main__":
    main()
