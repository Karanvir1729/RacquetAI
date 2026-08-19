#!/usr/bin/env python3
"""Pull ONLY the frames needed from the 1920x1080 archive.org original.

The .mov is 1.36 GB and /download 503s under any real load, but the storage
node honours HTTP range requests, so ffmpeg seeks and decodes just the window
we ask for -- tens of MB instead of the whole file. Frames are written as PNG
into a scratch directory and are meant to be deleted by the caller.

Frame correspondence is VERIFIED by picture content, never assumed: each
extracted high-res frame is downscaled and matched against a window of mp4
frames, and the offset must be consistent across the whole segment or the
segment is rejected. Timestamps between two encodes of the same source are not
trustworthy enough to skip this.
"""
import argparse
import os
import subprocess
import sys

import cv2
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30000.0 / 1001.0
BASE = "https://dn801207.us.archive.org/0/items/0-c-0-ecc-7-c-2356-4037-b-4-a-7-d-24271393070"
MOV = {"archive_match2": "48242105-EC60-4EB9-BDA7-7DBD510DD248",
       "archive_match3": "0C0ECC7C-2356-4037-B4A7-D24271393070",
       "archive_match4": "F2D5569C-5C5B-42DB-9D0F-4249554D9E8A"}


def fetch(clip, start_frame, n, outdir):
    os.makedirs(outdir, exist_ok=True)
    url = f"{BASE}/{MOV[clip]}.mov"
    t = max(start_frame - 2, 0) / FPS
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{t:.5f}",
           "-i", url, "-frames:v", str(n + 4), "-f", "image2",
           os.path.join(outdir, "hr_%03d.png")]
    subprocess.run(cmd, check=True)
    return sorted(f for f in os.listdir(outdir) if f.startswith("hr_"))


def mp4_frames(clip, lo, n):
    cap = cv2.VideoCapture(os.path.join(REPO, "samples", clip + ".mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
    out = {}
    for k in range(n):
        ok, fr = cap.read()
        if not ok:
            break
        out[lo + k] = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
    cap.release()
    return out


def match_offset(hr_paths, ref):
    """Find the mp4 frame index each high-res frame corresponds to."""
    best = []
    for p in hr_paths:
        img = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
        small = cv2.resize(img, (854, 480), interpolation=cv2.INTER_AREA)
        sc = {f: float(np.mean(np.abs(small.astype(np.int16) - g.astype(np.int16))))
              for f, g in ref.items()}
        f = min(sc, key=sc.get)
        best.append((os.path.basename(p), f, sc[f]))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", default="archive_match4")
    ap.add_argument("--start", type=int, required=True)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()

    files = fetch(args.clip, args.start, args.n, args.outdir)
    paths = [os.path.join(args.outdir, f) for f in files]
    ref = mp4_frames(args.clip, args.start - 6, args.n + 12)
    pairs = match_offset(paths, ref)
    offs = [f - int(name.split("_")[1].split(".")[0]) for name, f, _ in pairs]
    med = int(np.median(offs))
    consistent = sum(1 for o in offs if o == med)
    print(f"clip={args.clip} start={args.start} files={len(paths)}")
    print(f"offset (mp4_frame - hr_index) median={med}  "
          f"consistent {consistent}/{len(offs)}")
    for (name, f, d), o in zip(pairs, offs):
        flag = "" if o == med else "   <-- INCONSISTENT"
        print(f"   {name} -> mp4 f{f}  meanAbsDiff={d:5.2f}  off={o}{flag}")
    if consistent < len(offs) - 1:
        print("REJECT: frame correspondence is not consistent", file=sys.stderr)
        sys.exit(2)
    # rename to the mp4 frame number so downstream code needs no offset logic
    for name, f, _ in pairs:
        src = os.path.join(args.outdir, name)
        dst = os.path.join(args.outdir, f"f{f}.png")
        if src != dst:
            os.replace(src, dst)
    print("renamed to f<mp4frame>.png")


if __name__ == "__main__":
    main()
