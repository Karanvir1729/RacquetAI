#!/usr/bin/env python3
"""Second-generation audio descriptors for every onset, merged into features_<clip>.json.

The first pass showed attack/centroid alone barely separate strikes from
between-point noise. This pass measures the thing that physically distinguishes
a ball-on-strings impact from a footstep, a squeak or a swell: how fast the
energy rises, in which band, and how cleanly it decays.

    .venv/bin/python tools/dump_audio2.py --clip archive_match2 --out out/archive_match2_v2
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PRE_S, POST_S = 0.35, 0.40


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sr", type=int, default=22050)
    ap.add_argument("--suffix", default="")
    args = ap.parse_args()

    import librosa
    wav = os.path.join(args.out, "_tmp", "audio.wav")
    y, sr = librosa.load(wav, sr=args.sr, mono=True)
    fpath = os.path.join(ROOT, "eval", f"features_{args.clip}.json")
    blob = json.load(open(fpath))
    onsets = [r["t"] for r in blob["onsets"]]

    n_fft = 512 if sr <= 24000 else 1024
    hop = 16 if sr <= 24000 else 32          # ~0.73 ms both ways
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    # band masks
    def m(a, b):
        return (freqs >= a) & (freqs < b)
    B = {"lo": m(0, 400), "mid": m(400, 1500), "body": m(1500, 4000),
         "hi": m(4000, min(9000, sr / 2)), "vhi": m(9000, sr / 2)}

    dt = hop / sr
    for rec in blob["onsets"]:
        t = rec["t"]
        i0, i1 = int((t - PRE_S) * sr), int((t + POST_S) * sr)
        seg = y[max(0, i0):min(len(y), i1)]
        pad0 = max(0, -i0)
        if len(seg) < n_fft * 2:
            rec["a2"] = None
            continue
        S = np.abs(librosa.stft(seg, n_fft=n_fft, hop_length=hop, center=True)) ** 2
        ft = (np.arange(S.shape[1]) * hop - pad0) / sr - PRE_S
        e = S.sum(axis=0) + 1e-12
        eb = {k: S[v].sum(axis=0) + 1e-12 for k, v in B.items()}
        cand = np.where((ft >= -0.045) & (ft <= 0.070))[0]
        if len(cand) == 0:
            rec["a2"] = None
            continue
        pk = int(cand[np.argmax(e[cand])])

        def at(arr, off):
            j = pk + int(round(off / dt))
            j = min(max(j, 0), len(arr) - 1)
            return float(arr[j])

        def rise(arr, off):
            return 10 * math.log10(at(arr, 0.0) / max(at(arr, -off), 1e-12))

        # background floor from well before the transient
        pre_m = (ft < -0.12) & (ft > -0.34)
        floor = float(np.median(e[pre_m])) if pre_m.sum() > 4 else float(np.median(e))
        peak = e[pk]

        # spectrum of the ADDED energy at the peak
        bg = np.median(S[:, pre_m], axis=1) if pre_m.sum() > 4 else np.zeros(S.shape[0])
        add = np.maximum(S[:, pk] - bg, 0.0)
        tot = add.sum() + 1e-12
        cadd = float((freqs * add).sum() / tot)
        cum = np.cumsum(add) / tot
        r85 = float(freqs[int(np.searchsorted(cum, 0.85))])

        # how impulsive: peak over the mean of the 150 ms that follows
        post_m = (ft > 0.02) & (ft < 0.17)
        post_mean = float(np.mean(e[post_m])) if post_m.sum() else peak
        # and over the 150 ms before
        prev_m = (ft > -0.17) & (ft < -0.02)
        prev_mean = float(np.mean(e[prev_m])) if prev_m.sum() else peak

        # time to fall 6 dB
        j = pk
        while j < len(e) - 1 and e[j + 1] > peak * 0.25:
            j += 1
        t6 = (j - pk) * dt * 1000

        a2 = dict(
            rise5=round(rise(e, 0.005), 2),
            rise10=round(rise(e, 0.010), 2),
            rise20=round(rise(e, 0.020), 2),
            rise40=round(rise(e, 0.040), 2),
            riseBody10=round(rise(eb["body"], 0.010), 2),
            riseHi10=round(rise(eb["hi"], 0.010), 2),
            riseLo10=round(rise(eb["lo"], 0.010), 2),
            riseMid10=round(rise(eb["mid"], 0.010), 2),
            promDb=round(10 * math.log10(peak / max(floor, 1e-12)), 2),
            impPost=round(10 * math.log10(peak / max(post_mean, 1e-12)), 2),
            impPre=round(10 * math.log10(peak / max(prev_mean, 1e-12)), 2),
            t6=round(t6, 1),
            cadd=round(cadd, 1),
            r85=round(r85, 1),
            fLo=round(float(add[B["lo"]].sum() / tot), 4),
            fMid=round(float(add[B["mid"]].sum() / tot), 4),
            fBody=round(float(add[B["body"]].sum() / tot), 4),
            fHi=round(float(add[B["hi"]].sum() / tot), 4),
            fVhi=round(float(add[B["vhi"]].sum() / tot), 4) if B["vhi"].any() else 0.0,
        )
        rec["a2" + args.suffix] = a2

    with open(fpath, "w") as f:
        json.dump(blob, f)
    print(f"{args.clip}: a2{args.suffix} for {len(onsets)} onsets @ {sr} Hz -> {fpath}")


if __name__ == "__main__":
    main()
