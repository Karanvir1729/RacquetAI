#!/usr/bin/env python3
"""Freeze the rally-activity gate's inputs and outputs as a Swift-readable fixture.

The Swift engine has to reach the same shot count as analyze.py on the same
footage, so the port is checked against the reference here rather than by eye.
This dumps, for one clip:

    times, and per pose frame per player the ONLY fields the gate reads
        (both wrists x/y/conf, bbox height, court position),
    the audio onsets that go into the gate,
    and everything the reference computes from them — per-frame wrist speed,
        the activity signal, both thresholds, the survivors of each pass.

Every expected value is produced by calling analyze.py's own functions on the
ROUNDED inputs that go into the JSON, so a Swift run reading this file sees
bit-identical doubles and any mismatch is a real porting bug, not rounding.

Read-only over analysis/out/<clip>_v2/{pose_cache_v3.pkl,_tmp/audio.wav}.

    .venv/bin/python tools/dump_gate_fixture.py --video samples/archive_match2.mp4 \
        --corners samples/archive_match2.corners.json --out out/archive_match2_v2 \
        --json /tmp/gate_archive_match2.json
"""
import argparse
import json
import math
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cv2  # noqa: E402
import analyze as az  # noqa: E402

WRIST_PEAK_GATE = 1.9   # analyze.py main(), local constants
ANKLE_GATE = 0.30


def build_track_frames(out_dir, corners_path):
    """Re-run tracking over the cached poses (no pose inference)."""
    corners = json.load(open(corners_path))["corners"]
    src = np.float32([corners["frontLeft"], corners["frontRight"],
                      corners["backLeft"], corners["backRight"]])
    dst = np.float32([[0, 0], [az.COURT_W, 0], [0, az.COURT_L], [az.COURT_W, az.COURT_L]])
    h_ref2court = cv2.getPerspectiveTransform(src, dst)
    with open(os.path.join(out_dir, "pose_cache_v3.pkl"), "rb") as f:
        blob = pickle.load(f)
    times, raw_frames = blob["times"], blob["raw_frames"]
    aligns, _ = az.build_alignments(blob["directs"], blob["steps"])
    tracker = az.TwoTracker()
    frames = []
    for i in range(len(times)):
        frames.append(tracker.update(
            az.detect_players(raw_frames[i], h_ref2court @ aligns[i]), times[i]))
    return [float(t) for t in times], frames


def reduce_frames(track_frames):
    """Keep only what the gate reads, rounded to what the JSON will carry.

    Returns (json_frames, replay_frames) where replay_frames are analyze.py-shaped
    dicts rebuilt FROM the rounded numbers, so the expectations below are computed
    on exactly the values Swift will parse.
    """
    js, replay = [], []
    for tf in track_frames:
        jrow, rrow = {}, {}
        for pid in ("A", "B"):
            d = tf.get(pid)
            if d is None:
                continue
            k, s = d["kpts"], d["scores"]
            lw = [round(float(k[az.L_WRI][0]), 4), round(float(k[az.L_WRI][1]), 4),
                  round(float(s[az.L_WRI]), 6)]
            rw = [round(float(k[az.R_WRI][0]), 4), round(float(k[az.R_WRI][1]), 4),
                  round(float(s[az.R_WRI]), 6)]
            h = round(float(d["bbox_h"]), 4)
            court = [round(float(d["court"][0]), 6), round(float(d["court"][1]), 6)]
            jrow[pid] = {"lw": lw, "rw": rw, "h": h, "court": court}
            kpts = np.zeros((17, 2), dtype=np.float64)
            scores = np.zeros(17, dtype=np.float64)
            kpts[az.L_WRI] = lw[:2]
            kpts[az.R_WRI] = rw[:2]
            scores[az.L_WRI], scores[az.R_WRI] = lw[2], rw[2]
            rrow[pid] = {"kpts": kpts, "scores": scores, "bbox_h": h,
                         "court": (court[0], court[1])}
        js.append(jrow)
        replay.append(rrow)
    return js, replay


def run_gates(track_frames, times, onsets, audio_available=True):
    """Verbatim replay of analyze.py main()'s two-pass shot gate."""
    n_gated = 0
    passed = []
    for t in onsets:
        lo = max(0, int(np.searchsorted(times, t - az.WRIST_WIN_S)))
        hi = min(len(times) - 1, int(np.searchsorted(times, t + az.WRIST_WIN_S)))
        if hi < lo:
            continue
        trav, obs = {}, {}
        for p in ("A", "B"):
            trav[p], obs[p] = az.peak_wrist_speed(track_frames, times, lo, hi, p)
        if obs["A"] >= 2 or obs["B"] >= 2:
            if audio_available and max(trav.values()) < WRIST_PEAK_GATE:
                n_gated += 1
                continue
        else:
            def ankle_speed(pid):
                pts = [(times[i],) + tuple(track_frames[i][pid]["court"])
                       for i in range(lo, hi + 1) if pid in track_frames[i]]
                if len(pts) < 2:
                    return 0.0
                return sum(math.hypot(b[1] - a[1], b[2] - a[2]) for a, b in zip(pts, pts[1:]))
            trav = {p: ankle_speed(p) for p in ("A", "B")}
            if max(trav.values()) < (ANKLE_GATE if audio_available else 1e-9):
                n_gated += 1
                continue
        pid = "A" if trav["A"] >= trav["B"] else "B"
        passed.append((float(t), pid, float(max(trav.values()))))

    act = az.rally_activity(track_frames, times)
    act_thr = float(np.percentile(act, az.RALLY_ACT_Q)) if len(act) else 0.0
    strong_thr = (az.STRONG_SWING_F * float(np.percentile([p[2] for p in passed], 90))
                  if passed else float("inf"))
    kept, n_rally_gated = [], 0
    for t, pid, peak in passed:
        j = int(np.clip(np.searchsorted(times, t), 0, len(times) - 1))
        if j > 0 and abs(times[j - 1] - t) < abs(times[j] - t):
            j -= 1
        if act[j] < act_thr and peak < strong_thr:
            n_rally_gated += 1
            continue
        if az.nearest_tracked(track_frames, times, t, pid) is None:
            continue
        kept.append([t, pid])
    return {"act": act, "act_thr": act_thr, "strong_thr": strong_thr,
            "passed": passed, "kept": kept,
            "n_gated": n_gated, "n_rally_gated": n_rally_gated}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--json", required=True)
    args = ap.parse_args()

    times, track_frames = build_track_frames(args.out, args.corners)
    js_frames, replay = reduce_frames(track_frames)

    wav = os.path.join(args.out, "_tmp", "audio.wav")
    if not os.path.exists(wav):
        raise SystemExit(f"no extracted audio at {wav}")
    onsets, _ = az.audio_onsets(wav)
    cap = cv2.VideoCapture(args.video)
    duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / (cap.get(cv2.CAP_PROP_FPS) or 1.0)
    cap.release()
    onsets = [float(t) for t in onsets if t <= duration]  # analyze.py main()

    per = az.wrist_speed_frames(replay, times)
    g = run_gates(replay, times, onsets)

    # Inputs are rounded (above) and the expectations are computed FROM those
    # rounded inputs, so the numbers below are written at full precision:
    # json.dump emits the shortest repr that round-trips, and Swift's Double
    # parser reconstructs the identical bits. Rounding the outputs — or the
    # times, which divide into every speed — would inject a ~1e-9 error that
    # looks exactly like a porting bug.
    def nan_none(a):
        return [None if math.isnan(v) else float(v) for v in a]

    fixture = {
        "clip": os.path.basename(args.video),
        "params": {"kptConf": az.KPT_CONF, "wristSpeedMaxDt": 0.4,
                   "wristWinS": az.WRIST_WIN_S, "wristPeakGate": WRIST_PEAK_GATE,
                   "ankleGate": ANKLE_GATE, "nearestTrackedMaxDt": 0.6,
                   "rallyWinS": az.RALLY_WIN_S, "rallyActQ": az.RALLY_ACT_Q,
                   "rallyMinObs": az.RALLY_MIN_OBS, "strongSwingF": az.STRONG_SWING_F},
        "times": times,
        "frames": js_frames,
        "onsets": onsets,
        "expect": {
            "wA": nan_none(per["A"]),
            "wB": nan_none(per["B"]),
            "act": [float(v) for v in g["act"]],
            "actThr": g["act_thr"],
            "strongThr": g["strong_thr"],
            "passed": [[t, pid, pk] for t, pid, pk in g["passed"]],
            "kept": [[t, pid] for t, pid in g["kept"]],
            "nGated": g["n_gated"],
            "nRallyGated": g["n_rally_gated"],
        },
    }
    with open(args.json, "w") as f:
        json.dump(fixture, f)
    print(f"{fixture['clip']}: {len(times)} frames, {len(onsets)} onsets, "
          f"{len(g['passed'])} passed swing gate, {g['n_rally_gated']} rally-gated, "
          f"{len(g['kept'])} shots -> {args.json}")


if __name__ == "__main__":
    main()
