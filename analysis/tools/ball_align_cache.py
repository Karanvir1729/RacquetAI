#!/usr/bin/env python3
"""Cache ORB-aligned frame windows around every labelled ball segment.

Detectors in ball_detect.py read this cache instead of decoding video, so a
parameter sweep costs seconds instead of minutes.

WHAT IS STORED, per segment
    gray[i]      raw grayscale of frame startFrame-PAD+i, uint8, in that
                 frame's OWN pixel coordinates (labels live in these)
    Hstep[i]     homography mapping frame i -> frame i+1 (ORB+RANSAC)
    inl[i]       RANSAC inlier count for Hstep[i]; low = alignment unreliable

Neighbours are warped into frame t's coordinates on demand by chaining Hstep,
so residuals come out in the same coordinate frame the labels use and no
back-mapping is needed. Chaining over <= 3 steps at 30 fps is a short baseline;
the wide-baseline plane-mixing problem that forces analyze.py to anchor-chain
does not arise here.

    python tools/ball_align_cache.py --out eval/ball_align_cache
"""
import argparse
import json
import os

import cv2
import numpy as np

PAD = 4  # frames of context kept either side of each 12-frame segment
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fit_h(kp_a, desc_a, kp_b, desc_b, matcher):
    """Homography mapping a -> b, or (None, 0). Same recipe as analyze.py."""
    if desc_a is None or desc_b is None or len(kp_a) < 30 or len(kp_b) < 30:
        return None, 0
    matches = matcher.match(desc_a, desc_b)
    if len(matches) < 30:
        return None, 0
    matches = sorted(matches, key=lambda m: m.distance)[:600]
    src = np.float32([kp_a[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst = np.float32([kp_b[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if H is None:
        return None, 0
    det = np.linalg.det(H[:2, :2])
    if not (0.25 < det < 4.0):
        return None, 0
    return H / H[2, 2], int(mask.sum())


def read_window(video, start, n):
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    frames = []
    for _ in range(n):
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    return frames


def build_segment(video, start_frame, n_frames, scale=1.0):
    """Grayscale window plus consecutive-step homographies."""
    lo = start_frame - PAD
    n = n_frames + 2 * PAD
    bgr = read_window(video, lo, n)
    if len(bgr) < n:
        return None
    if scale != 1.0:
        bgr = [cv2.resize(f, (0, 0), fx=scale, fy=scale,
                          interpolation=cv2.INTER_AREA) for f in bgr]
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in bgr]

    orb = cv2.ORB_create(2500)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    feats = [orb.detectAndCompute(g, None) for g in gray]

    Hstep, inl = [], []
    for i in range(len(gray) - 1):
        H, k = _fit_h(feats[i][0], feats[i][1], feats[i + 1][0], feats[i + 1][1],
                      matcher)
        Hstep.append(np.eye(3) if H is None else H)
        inl.append(k)
    return {
        "lo": lo,
        "gray": np.stack(gray),
        "Hstep": np.stack(Hstep) if Hstep else np.zeros((0, 3, 3)),
        "inl": np.array(inl, dtype=np.int32),
    }


def chain(Hstep, i, j):
    """Homography mapping frame i's pixels into frame j's coordinates."""
    H = np.eye(3)
    if i < j:
        for k in range(i, j):
            H = Hstep[k] @ H
    else:
        for k in range(j, i):
            H = np.linalg.inv(Hstep[k]) @ H
    return H / H[2, 2]


def warp_into(gray_i, Hstep, i, j, shape):
    """Warp frame i into frame j's coordinates; returns (warped, validmask)."""
    H = chain(Hstep, i, j)
    h, w = shape
    out = cv2.warpPerspective(gray_i, H, (w, h), flags=cv2.INTER_LINEAR,
                              borderValue=0)
    valid = cv2.warpPerspective(np.full(gray_i.shape, 255, np.uint8), H, (w, h),
                                flags=cv2.INTER_NEAREST, borderValue=0)
    return out, valid > 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(REPO, "eval/ball_labels_v1.json"))
    ap.add_argument("--out", default=os.path.join(REPO, "eval/ball_align_cache"))
    ap.add_argument("--scale", type=float, default=1.0)
    args = ap.parse_args()

    labels = json.load(open(args.labels))
    os.makedirs(args.out, exist_ok=True)
    for seg in labels["segments"]:
        video = os.path.join(REPO, "samples", seg["clip"] + ".mp4")
        n = len(seg["frames"])
        got = build_segment(video, seg["startFrame"], n, args.scale)
        if got is None:
            print("SKIP (short read)", seg["seg"])
            continue
        path = os.path.join(args.out, seg["seg"].replace("#", "_s") + ".npz")
        np.savez_compressed(path, **got)
        print(f"{seg['seg']:22s} lo={got['lo']} n={len(got['gray'])} "
              f"median_inliers={int(np.median(got['inl']))}")


if __name__ == "__main__":
    main()
