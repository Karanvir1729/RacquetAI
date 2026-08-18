#!/usr/bin/env python3
"""Dump the CURRENT detector's shot candidates without touching analyze.py.

Re-runs only the cheap half of the pipeline (pose cache -> tracking -> audio
onsets -> player-activity gate) by importing analyze.py and re-executing the
same code path main() takes, and writes every intermediate decision to JSON so
the detector can be scored against hand labels.

    .venv/bin/python tools/dump_candidates.py \
        --video samples/archive_match2.mp4 \
        --corners samples/archive_match2.corners.json \
        --out out/archive_match2_v2 \
        --json eval/candidates_archive_match2.json

Output JSON:
    onsets       : every audio onset time (s)
    candidates   : one record per onset -- travA/travB (peak scale-normalised
                   wrist speed, or the ankle-travel fallback), obsA/obsB,
                   gate pass/fail, and the attributed striker when it passed
    shots_raw    : [{t, player}] -- the detector's shot list before the
                   retrieval-proxy stage drops the last shot of each rally
    rally_gap_s  : the rally split used
This tool is READ-ONLY with respect to analyze.py; it must stay a faithful
mirror of main()'s detection block.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cv2  # noqa: E402
import analyze as az  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True, help="dir holding pose_cache_v3.pkl")
    ap.add_argument("--json", required=True)
    ap.add_argument("--rally-gap", type=float, default=az.RALLY_GAP_S)
    args = ap.parse_args()

    corners = json.load(open(args.corners))
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = n_frames / fps
    c = corners["corners"]
    src = np.float32([c["frontLeft"], c["frontRight"], c["backLeft"], c["backRight"]])
    dst = np.float32([[0, 0], [az.COURT_W, 0], [0, az.COURT_L], [az.COURT_W, az.COURT_L]])
    H_ref2court = cv2.getPerspectiveTransform(src, dst)
    cap.release()

    cache_path = os.path.join(args.out, "pose_cache_v3.pkl")
    if not os.path.exists(cache_path):
        sys.exit(f"no pose cache at {cache_path}; this tool never runs pose inference")
    import pickle
    with open(cache_path, "rb") as f:
        blob = pickle.load(f)
    times, raw_frames = blob["times"], blob["raw_frames"]
    directs, steps = blob["directs"], blob["steps"]

    aligns, anchored_pct = az.build_alignments(directs, steps)
    track_frames = []
    tracker = az.TwoTracker()
    for i in range(len(times)):
        H_px2court = H_ref2court @ aligns[i]
        track_frames.append(tracker.update(az.detect_players(raw_frames[i], H_px2court), times[i]))

    tmp = os.path.join(args.out, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    wav = az.extract_audio(args.video, tmp)
    if wav is None:
        sys.exit("no audio")
    onsets, _ = az.audio_onsets(wav)
    onsets = [t for t in onsets if t <= duration]

    WRIST_PEAK_GATE = 1.9
    ANKLE_GATE = 0.30
    act = az.rally_activity(track_frames, times)
    act_thr = float(np.percentile(act, az.RALLY_ACT_Q)) if len(act) else 0.0
    cands, shots_raw, passed = [], [], []
    for t in onsets:
        lo = max(0, int(np.searchsorted(times, t - az.WRIST_WIN_S)))
        hi = min(len(times) - 1, int(np.searchsorted(times, t + az.WRIST_WIN_S)))
        rec = {"t": round(float(t), 3), "passed": False, "reason": "", "player": None}
        if hi < lo:
            rec["reason"] = "no frames"
            cands.append(rec)
            continue
        trav, obs = {}, {}
        for p in ("A", "B"):
            trav[p], obs[p] = az.peak_wrist_speed(track_frames, times, lo, hi, p)
        rec["mode"] = "wrist"
        if obs["A"] >= 2 or obs["B"] >= 2:
            if max(trav.values()) < WRIST_PEAK_GATE:
                rec.update(travA=round(trav["A"], 3), travB=round(trav["B"], 3),
                           obsA=obs["A"], obsB=obs["B"], reason="wrist gate")
                cands.append(rec)
                continue
        else:
            def ankle_speed(pid):
                pts = [(times[i],) + track_frames[i][pid]["court"]
                       for i in range(lo, hi + 1) if pid in track_frames[i]]
                if len(pts) < 2:
                    return 0.0
                return sum(math.hypot(b[1] - a[1], b[2] - a[2]) for a, b in zip(pts, pts[1:]))
            trav = {p: ankle_speed(p) for p in ("A", "B")}
            rec["mode"] = "ankle"
            if max(trav.values()) < ANKLE_GATE:
                rec.update(travA=round(trav["A"], 3), travB=round(trav["B"], 3),
                           obsA=obs["A"], obsB=obs["B"], reason="ankle gate")
                cands.append(rec)
                continue
        pid = "A" if trav["A"] >= trav["B"] else "B"
        rec.update(travA=round(trav["A"], 3), travB=round(trav["B"], 3),
                   obsA=obs["A"], obsB=obs["B"], player=pid)
        j = int(np.clip(np.searchsorted(times, t), 0, len(times) - 1))
        if j > 0 and abs(times[j - 1] - t) < abs(times[j] - t):
            j -= 1
        rec["act"] = round(float(act[j]), 3)
        cands.append(rec)
        passed.append((rec, float(t), pid, float(max(trav.values()))))

    # rally-activity gate (second stage), mirroring analyze.py
    strong_thr = (az.STRONG_SWING_F * float(np.percentile([p[3] for p in passed], 90))
                  if passed else float("inf"))
    for rec, t, pid, peak in passed:
        if rec["act"] < act_thr and peak < strong_thr:
            rec["reason"] = "rally gate"
            continue
        i = az.nearest_tracked(track_frames, times, t, pid)
        if i is None:
            rec["reason"] = "no tracked frame"
            continue
        rec["passed"] = True
        rec["court"] = [round(v, 2) for v in track_frames[i][pid]["court"]]
        shots_raw.append({"t": round(float(t), 3), "player": pid})

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w") as f:
        json.dump({
            "video": os.path.basename(args.video),
            "durationSec": round(duration, 2),
            "fps": round(fps, 3),
            "rallyGapSec": args.rally_gap,
            "anchoredPct": round(anchored_pct, 1),
            "nOnsets": len(onsets),
            "nPassed": len(shots_raw),
            "onsets": [round(float(t), 3) for t in onsets],
            "shotsRaw": shots_raw,
            "candidates": cands,
        }, f, indent=1)
    print(f"{os.path.basename(args.video)}: {len(onsets)} onsets, {len(shots_raw)} passed gate "
          f"-> {args.json}")


if __name__ == "__main__":
    main()
