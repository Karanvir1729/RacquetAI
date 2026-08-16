#!/usr/bin/env python3
"""Tile frames from a time window into a contact sheet for eyeball verification."""
import argparse

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--width", type=int, default=420, help="tile width px")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    ts = np.linspace(args.start, args.end, args.n)
    tiles = []
    for t in ts:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, f = cap.read()
        if not ok:
            continue
        h = int(f.shape[0] * args.width / f.shape[1])
        f = cv2.resize(f, (args.width, h))
        cv2.putText(f, f"{t:.2f}s", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(f, f"{t:.2f}s", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (0, 255, 255), 2, cv2.LINE_AA)
        tiles.append(f)
    cap.release()
    rows = []
    for i in range(0, len(tiles), args.cols):
        row = tiles[i:i + args.cols]
        while len(row) < args.cols:
            row.append(np.zeros_like(tiles[0]))
        rows.append(np.hstack(row))
    cv2.imwrite(args.out, np.vstack(rows))
    print(args.out)


if __name__ == "__main__":
    main()
