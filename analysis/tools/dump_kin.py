#!/usr/bin/env python3
"""Per-pose-frame kinematic time series for both tracked players.

Dumps the raw scalars once so window features can be explored without
re-running tracking. Read-only over analysis/out/<clip>_v2/pose_cache_v3.pkl.

Per frame, per player id:
    wri   scale-normalised wrist speed  (bbox-heights / s, max of both wrists)
    elb   same for elbows
    tor   same for the shoulder/hip midpoint  (whole-body translation)
    rel   max(0, wri - tor)  -- how much faster the hand moves than the body,
          which is what separates a stroke from an arm swinging while walking
    ext   wrist-to-shoulder distance / bbox_h  (arm extension)
    x,y   court position (m), conf = ankle score
    h     bbox height (px)

    .venv/bin/python tools/dump_kin.py --video samples/archive_match2.mp4 \
        --corners samples/archive_match2.corners.json --out out/archive_match2_v2 \
        --json eval/kin_archive_match2.json
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

L_ELB, R_ELB = 7, 8


def joint_speed(prev, cur_d, cur_t, joints, h):
    """max scale-normalised speed over the given joint indices."""
    best = None
    for j in joints:
        if cur_d["scores"][j] > az.KPT_CONF:
            p = cur_d["kpts"][j]
            if j in prev:
                q, tq = prev[j]
                dt = cur_t - tq
                if 0 < dt < 0.4:
                    v = float(np.hypot(*(p - q))) / max(h, 1.0) / dt
                    best = v if best is None else max(best, v)
            prev[j] = (p, cur_t)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--json", required=True)
    ap.add_argument("--align", action="store_true",
                    help="measure joint speeds in reference-frame pixels instead of raw "
                         "frame pixels, cancelling handheld camera pan. MEASURED WORSE: "
                         "on the three archive clips this lowered detector precision at "
                         "every operating point (e.g. 0.72 -> 0.67 at wrist/h1.5/q65), "
                         "because ORB alignment jitter adds more noise than the pan it "
                         "removes. The shipped algorithm uses raw pixels; kept for "
                         "reproducing that negative result.")
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
    track_frames = []
    for i in range(len(times)):
        track_frames.append(tracker.update(
            az.detect_players(raw_frames[i], H_ref2court @ aligns[i]), times[i]))

    prevW = {"A": {}, "B": {}}
    prevE = {"A": {}, "B": {}}
    prevT = {"A": None, "B": None}
    out = {"A": [], "B": []}
    for i, t in enumerate(times):
        for pid in ("A", "B"):
            d = track_frames[i].get(pid)
            if d is None:
                out[pid].append(None)
                continue
            if args.align:
                d = dict(d, kpts=cv2.perspectiveTransform(
                    d["kpts"].reshape(-1, 1, 2).astype(np.float32), aligns[i]).reshape(-1, 2))
            h = d["bbox_h"]
            wri = joint_speed(prevW[pid], d, t, (az.L_WRI, az.R_WRI), h)
            elb = joint_speed(prevE[pid], d, t, (L_ELB, R_ELB), h)
            k, s = d["kpts"], d["scores"]
            tor = None
            if all(s[j] > az.KPT_CONF for j in (az.L_SHO, az.R_SHO, az.L_HIP, az.R_HIP)):
                c = 0.25 * (k[az.L_SHO] + k[az.R_SHO] + k[az.L_HIP] + k[az.R_HIP])
                if prevT[pid] is not None:
                    q, tq = prevT[pid]
                    dt = t - tq
                    if 0 < dt < 0.4:
                        tor = float(np.hypot(*(c - q))) / max(h, 1.0) / dt
                prevT[pid] = (c, t)
            ext = None
            for wj, sj in ((az.L_WRI, az.L_SHO), (az.R_WRI, az.R_SHO)):
                if s[wj] > az.KPT_CONF and s[sj] > az.KPT_CONF:
                    e = float(np.hypot(*(k[wj] - k[sj]))) / max(h, 1.0)
                    ext = e if ext is None else max(ext, e)
            x, y = d["court"]
            out[pid].append({
                "wri": None if wri is None else round(wri, 3),
                "elb": None if elb is None else round(elb, 3),
                "tor": None if tor is None else round(tor, 3),
                "ext": None if ext is None else round(ext, 3),
                "x": round(x, 2), "y": round(y, 2),
                "c": round(d["pos_conf"], 2), "h": round(h, 1),
            })

    with open(args.json, "w") as f:
        json.dump({"video": os.path.basename(args.video),
                   "times": [round(float(t), 4) for t in times],
                   "frames": out}, f)
    print(f"{os.path.basename(args.video)}: {len(times)} pose frames -> {args.json}")


if __name__ == "__main__":
    main()
