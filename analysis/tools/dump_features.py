#!/usr/bin/env python3
"""Per-onset feature dump: everything a smarter shot gate might use.

Read-only with respect to analyze.py and the pose caches. For every audio onset
the current detector produces, this writes:

  audio/*   - short-window spectral descriptors of the transient itself
              (attack, decay, prominence over the local floor, spectral
              centroid / rolloff / band split of the onset's *added* energy)
  kin/*     - the scale-normalised wrist-speed profile of each tracked player
              around the onset, its peak and where the peak sits in time,
              plus court (ankle) speed and the players' separation
  ctx/*     - spacing to the neighbouring onsets

    .venv/bin/python tools/dump_features.py \
        --video samples/archive_match2.mp4 \
        --corners samples/archive_match2.corners.json \
        --out out/archive_match2_v2 \
        --json eval/features_archive_match2.json
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

SR = 22050
N_FFT = 512
HOP = 32            # 1.45 ms — the transient is only a few ms wide
PRE_S = 0.30        # window pulled around each onset
POST_S = 0.40
KIN_S = 0.70        # kinematic profile half-width


def band_edges(freqs, edges):
    return [(np.searchsorted(freqs, a), np.searchsorted(freqs, b)) for a, b in edges]


def audio_features(y, sr, onsets):
    import librosa
    S_all = None  # per-onset local STFTs instead of one global one (memory)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    edges = [(0, 500), (500, 1500), (1500, 3000), (3000, 6000), (6000, sr / 2)]
    bidx = band_edges(freqs, edges)
    out = []
    for t in onsets:
        i0 = int((t - PRE_S) * sr)
        i1 = int((t + POST_S) * sr)
        seg = y[max(0, i0):min(len(y), i1)]
        pad0 = max(0, -i0)
        if len(seg) < N_FFT * 2:
            out.append(None)
            continue
        S = np.abs(librosa.stft(seg, n_fft=N_FFT, hop_length=HOP, center=True))
        P = (S ** 2)
        e = P.sum(axis=0) + 1e-12
        # frame times relative to the onset
        ft = (np.arange(S.shape[1]) * HOP - pad0) / sr - PRE_S
        # librosa's onset picker quantises to a 23 ms hop, so let the true peak
        # float inside a small bracket around the reported time
        cand = np.where((ft >= -0.045) & (ft <= 0.070))[0]
        if len(cand) == 0:
            out.append(None)
            continue
        pk = int(cand[np.argmax(e[cand])])
        peak = e[pk]
        # local floor: the quiet part of the window away from the transient
        floor_m = (ft < -0.10) | (ft > 0.25)
        floor = float(np.median(e[floor_m])) if floor_m.sum() > 4 else float(np.median(e))
        prom_db = 10 * math.log10(peak / max(floor, 1e-12))

        # attack: how far back the energy stays above 10% of peak
        thr = peak * 0.10
        j = pk
        while j > 0 and e[j - 1] > thr:
            j -= 1
        attack_ms = (pk - j) * HOP / sr * 1000.0
        # decay: forward to 10% of peak
        k = pk
        while k < len(e) - 1 and e[k + 1] > thr:
            k += 1
        decay_ms = (k - pk) * HOP / sr * 1000.0
        # decay to -20 dB
        thr20 = peak * 0.01
        k2 = pk
        while k2 < len(e) - 1 and e[k2 + 1] > thr20:
            k2 += 1
        decay20_ms = (k2 - pk) * HOP / sr * 1000.0

        # spectrum of the ADDED energy: peak frame minus the pre-onset background
        pre = (ft < -0.09) & (ft > -0.25)
        bg = np.median(P[:, pre], axis=1) if pre.sum() > 3 else np.zeros(P.shape[0])
        add = np.maximum(P[:, pk] - bg, 0.0)
        tot = add.sum() + 1e-12
        bands = [float(add[a:b].sum() / tot) for a, b in bidx]
        cent = float((freqs * add).sum() / tot)
        c = np.cumsum(add) / tot
        roll85 = float(freqs[int(np.searchsorted(c, 0.85))])
        roll95 = float(freqs[int(np.searchsorted(c, 0.95))])
        # flatness of the added spectrum
        a_pos = add + 1e-12
        flat = float(np.exp(np.mean(np.log(a_pos))) / np.mean(a_pos))
        # energy still in the same bands 60 ms later (ring-out / reverb tail)
        lt = np.searchsorted(ft, ft[pk] + 0.060)
        tail = float(e[min(lt, len(e) - 1)] / peak)

        out.append(dict(
            tPeak=round(float(ft[pk]), 4),
            promDb=round(prom_db, 2),
            peakDb=round(10 * math.log10(peak), 2),
            attackMs=round(attack_ms, 2),
            decayMs=round(decay_ms, 2),
            decay20Ms=round(decay20_ms, 2),
            centroid=round(cent, 1),
            roll85=round(roll85, 1),
            roll95=round(roll95, 1),
            flat=round(flat, 5),
            tail60=round(tail, 4),
            b0=round(bands[0], 4), b1=round(bands[1], 4), b2=round(bands[2], 4),
            b3=round(bands[3], 4), b4=round(bands[4], 4),
        ))
    del S_all
    return out


def wrist_series(track_frames, times, pid, lo, hi):
    """(t, scale-normalised wrist speed) samples for one player."""
    pts, prev = [], {}
    for i in range(lo, hi + 1):
        d = track_frames[i].get(pid)
        if d is None:
            continue
        best = None
        for j in (az.L_WRI, az.R_WRI):
            if d["scores"][j] > az.KPT_CONF:
                cur = d["kpts"][j]
                if j in prev:
                    dt = times[i] - prev[j][1]
                    if 0 < dt < 0.4:
                        v = float(np.hypot(*(cur - prev[j][0]))) / max(d["bbox_h"], 1.0) / dt
                        best = v if best is None else max(best, v)
                prev[j] = (cur, times[i])
        if best is not None:
            pts.append((float(times[i]), round(best, 3)))
    return pts


def court_speed(track_frames, times, pid, lo, hi):
    pts = [(times[i],) + tuple(track_frames[i][pid]["court"])
           for i in range(lo, hi + 1) if pid in track_frames[i]]
    if len(pts) < 2:
        return 0.0, 0.0
    tot = 0.0
    peak = 0.0
    for a, b in zip(pts, pts[1:]):
        d = math.hypot(b[1] - a[1], b[2] - a[2])
        dt = max(b[0] - a[0], 1e-3)
        tot += d
        peak = max(peak, d / dt)
    return tot, peak


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--json", required=True)
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

    with open(os.path.join(args.out, "pose_cache_v3.pkl"), "rb") as f:
        blob = pickle.load(f)
    times, raw_frames = blob["times"], blob["raw_frames"]
    aligns, _ = az.build_alignments(blob["directs"], blob["steps"])
    track_frames = []
    tracker = az.TwoTracker()
    for i in range(len(times)):
        H = H_ref2court @ aligns[i]
        track_frames.append(tracker.update(az.detect_players(raw_frames[i], H), times[i]))
    times = np.asarray(times)

    wav = os.path.join(args.out, "_tmp", "audio.wav")
    if not os.path.exists(wav):
        wav = az.extract_audio(args.video, os.path.join(args.out, "_tmp"))
    import librosa
    y, sr = librosa.load(wav, sr=SR, mono=True)
    onsets, _ = az.audio_onsets(wav)
    onsets = [t for t in onsets if t <= duration]

    af = audio_features(y, sr, onsets)

    recs = []
    on_arr = np.asarray(onsets)
    for n, t in enumerate(onsets):
        lo = max(0, int(np.searchsorted(times, t - KIN_S)))
        hi = min(len(times) - 1, int(np.searchsorted(times, t + KIN_S)))
        kin = {}
        for p in ("A", "B"):
            ser = wrist_series(track_frames, times, p, lo, hi)
            trav, cpk = court_speed(track_frames, times, p, lo, hi)
            kin[p] = {"w": [[round(ti - t, 3), v] for ti, v in ser],
                      "travel": round(trav, 3), "courtPeak": round(cpk, 3)}
        # players' separation at the nearest tracked frame
        sep = None
        ia = az.nearest_tracked(track_frames, times, t, "A")
        ib = az.nearest_tracked(track_frames, times, t, "B")
        if ia is not None and ib is not None:
            xa, ya = track_frames[ia]["A"]["court"]
            xb, yb = track_frames[ib]["B"]["court"]
            sep = round(math.hypot(xa - xb, ya - yb), 2)
        prev_dt = float(t - on_arr[n - 1]) if n > 0 else 99.0
        next_dt = float(on_arr[n + 1] - t) if n + 1 < len(on_arr) else 99.0
        recs.append({
            "t": round(float(t), 3),
            "audio": af[n],
            "kin": kin,
            "sep": sep,
            "nTrackedA": ia is not None, "nTrackedB": ib is not None,
            "prevDt": round(prev_dt, 3), "nextDt": round(next_dt, 3),
            "nIn3s": int(((on_arr > t - 3) & (on_arr < t + 3)).sum() - 1),
        })

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w") as f:
        json.dump({"video": os.path.basename(args.video), "durationSec": round(duration, 2),
                   "sr": SR, "nOnsets": len(onsets), "onsets": recs}, f)
    print(f"{os.path.basename(args.video)}: {len(onsets)} onsets -> {args.json}")


if __name__ == "__main__":
    main()
