#!/usr/bin/env python3
"""Freeze the list of rally breaks to hand-label, as explicit times.

Why this is a checked-in table of numbers rather than something recomputed:
the break list must not move while it is being labelled. It is derived from a
shot stream, and that stream is a moving target -- the detector was retuned
mid-session and archive_match2 went from 327 attributed shots to 184, which
turned a plausible 21-break structure with 4-15 s gaps into one with gaps up to
34.6 s that plainly swallow whole rallies. Labels keyed to boundary indices
would have silently re-pointed at different moments in the video.

So the breaks below are pinned. They come from the denser snapshot (327/291/428
attributed shots on match2/3/4), segmented by splitting at gaps >= 3.5 s and
dissolving segments of fewer than 3 shots as in-break noise. Each row is:

    (rallyStartSec, lastShotSec, nShotsInRally, gapSec, nextShotSec)

These are only where to LOOK. Who struck last and who won are decided by
watching the frames, never by these numbers.

    .venv/bin/python tools/make_breaks.py --json eval/breaks_v1.json
"""
import argparse
import json

BREAKS = {
    "archive_match2": [
        (0.97, 8.68, 9, 4.25, 12.93), (12.93, 20.94, 10, 9.47, 30.42),
        (30.42, 33.62, 4, 4.25, 37.87), (37.87, 56.96, 24, 9.47, 66.43),
        (66.43, 72.86, 6, 5.39, 78.25), (78.25, 94.37, 14, 5.22, 99.59),
        (99.59, 102.63, 4, 10.87, 113.50), (113.50, 120.60, 9, 3.99, 124.60),
        (124.60, 152.97, 27, 4.99, 157.97), (157.97, 171.90, 20, 14.49, 186.39),
        (186.39, 193.10, 7, 5.08, 198.18), (198.18, 208.45, 13, 6.69, 215.13),
        (215.13, 237.05, 26, 15.05, 252.10), (252.10, 259.23, 12, 7.03, 266.26),
        (266.26, 272.83, 11, 4.99, 277.83), (277.83, 287.90, 14, 10.50, 298.40),
        (298.40, 315.91, 12, 11.45, 327.36), (327.36, 350.16, 29, 10.59, 360.75),
        (360.75, 365.78, 7, 10.73, 376.51), (376.51, 405.68, 28, 3.72, 409.39),
        (409.39, 420.98, 17, 9.10, 430.08),
    ],
    "archive_match3": [
        (0.07, 7.15, 11, 12.82, 19.97), (19.97, 26.36, 8, 4.88, 31.23),
        (31.23, 38.71, 7, 5.09, 43.79), (43.79, 49.27, 8, 3.92, 53.20),
        (53.20, 56.08, 5, 10.66, 66.73), (66.73, 72.40, 8, 5.85, 78.25),
        (78.25, 81.59, 5, 4.04, 85.64), (85.64, 96.94, 10, 8.43, 105.37),
        (105.37, 111.32, 8, 6.25, 117.56), (117.56, 123.28, 5, 4.69, 127.97),
        (127.97, 139.09, 10, 5.46, 144.54), (144.54, 154.55, 9, 3.78, 158.34),
        (158.34, 183.04, 19, 23.50, 206.54), (206.54, 228.25, 19, 7.08, 235.33),
        (235.33, 248.50, 19, 6.04, 254.54), (254.54, 274.39, 19, 5.27, 279.66),
        (279.66, 282.29, 3, 5.08, 287.37), (287.37, 301.26, 16, 9.78, 311.03),
        (311.03, 326.33, 13, 21.11, 347.44), (347.44, 366.53, 23, 3.62, 370.15),
        (370.15, 374.61, 5, 4.30, 378.90), (378.90, 387.36, 8, 7.76, 395.11),
        (395.11, 407.93, 13, 3.55, 411.48), (411.48, 418.70, 9, 7.45, 426.16),
        (426.16, 437.53, 6, 6.55, 444.08),
    ],
    "archive_match4": [
        (1.74, 27.77, 29, 5.02, 32.79), (32.79, 48.67, 22, 4.16, 52.83),
        (52.83, 88.38, 31, 11.84, 100.22), (100.22, 111.18, 12, 9.54, 120.72),
        (120.72, 151.67, 35, 8.68, 160.36), (160.36, 163.44, 4, 4.76, 168.21),
        (168.21, 193.89, 26, 11.87, 205.75), (205.75, 210.91, 5, 5.06, 215.97),
        (215.97, 270.88, 58, 9.96, 280.85), (280.85, 286.49, 4, 3.55, 290.04),
        (290.04, 318.58, 30, 3.58, 322.15), (322.15, 330.88, 7, 6.22, 337.11),
        (337.11, 367.69, 42, 9.31, 377.00), (377.00, 392.00, 14, 3.71, 395.71),
        (395.71, 419.49, 33, 7.17, 426.67), (426.67, 437.00, 15, 10.52, 447.52),
        (447.52, 451.21, 6, 8.27, 459.48), (459.48, 462.56, 6, 6.78, 469.35),
        (469.35, 489.92, 17, 7.59, 497.51),
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", required=True)
    args = ap.parse_args()
    out = {"source": "shot stream snapshot with 327/291/428 attributed shots, "
                     "split at gaps >= 3.5 s, segments < 3 shots dissolved",
           "clips": {}}
    for clip, rows in BREAKS.items():
        out["clips"][clip] = [
            {"i": i, "rallyStart": r[0], "tA": r[1], "rallyShots": r[2],
             "gapSec": r[3], "tB": r[4]}
            for i, r in enumerate(rows)]
    with open(args.json, "w") as f:
        json.dump(out, f, indent=1)
    print(f"{sum(len(v) for v in out['clips'].values())} breaks -> {args.json}")


if __name__ == "__main__":
    main()
