#!/usr/bin/env python3
"""Fit a floor homography (image px -> court meters) from LINE correspondences.

Court frame: x in [0, 6.4] (0 = left wall), y in [0, 9.75] (0 = front wall).
Input: a JSON spec listing observed pixel points lying on known court lines
(e.g. the short line y=5.44, the half-court line x=3.2). Least-squares fit of
the 8 homography parameters so that projected points land on their lines.

Outputs <clip>.corners.json (the 4 floor-corner pixel coords, possibly outside
the frame) and a verification overlay with the projected court grid drawn.
"""
import argparse
import json

import cv2
import numpy as np
from scipy.optimize import least_squares

COURT_W = 6.4
COURT_L = 9.75
SHORT_Y = 5.44
BOX = 1.6


def h_from_params(p):
    return np.array([[p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], 1.0]])


def project(H, pts):
    pts = np.asarray(pts, dtype=np.float64)
    ones = np.ones((len(pts), 1))
    ph = (H @ np.hstack([pts, ones]).T).T
    return ph[:, :2] / ph[:, 2:3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True, help="JSON with lines + init points")
    ap.add_argument("--frame", required=True, help="reference frame image")
    ap.add_argument("--out-corners", required=True)
    ap.add_argument("--out-overlay", required=True)
    args = ap.parse_args()

    spec = json.load(open(args.spec))

    # ---- initial guess from 4 approximate point correspondences ----
    init = spec["initPoints"]  # [{"px": [x,y], "court": [X,Y]}...]
    src = np.float32([p["px"] for p in init])
    dst = np.float32([p["court"] for p in init])
    H0 = cv2.getPerspectiveTransform(src, dst)
    p0 = np.array([H0[0, 0], H0[0, 1], H0[0, 2], H0[1, 0], H0[1, 1], H0[1, 2], H0[2, 0], H0[2, 1]])

    # ---- residuals: distance in court space from projected point to its line ----
    obs = []  # (px, py, axis, value, weight)  axis 0 -> court x == value, 1 -> court y == value
    for line in spec["lines"]:
        axis = 0 if "x" in line else 1
        value = line.get("x", line.get("y"))
        w = line.get("weight", 1.0)
        for px, py in line["points"]:
            obs.append((px, py, axis, value, w))

    def resid(p):
        H = h_from_params(p)
        pts = project(H, [(o[0], o[1]) for o in obs])
        r = []
        for k, o in enumerate(obs):
            r.append((pts[k, o[2]] - o[3]) * o[4])
        return np.array(r)

    sol = least_squares(resid, p0, method="lm", max_nfev=20000)
    H = h_from_params(sol.x)
    r = resid(sol.x)
    print(f"fit: rms={np.sqrt((r ** 2).mean()):.3f} m, max={np.abs(r).max():.3f} m, nobs={len(obs)}")

    # ---- derive the 4 floor corner pixels from the inverse homography ----
    Hinv = np.linalg.inv(H)
    corners_court = {"frontLeft": (0, 0), "frontRight": (COURT_W, 0),
                     "backLeft": (0, COURT_L), "backRight": (COURT_W, COURT_L)}
    corners_px = {}
    for name, c in corners_court.items():
        px = project(Hinv, [c])[0]
        corners_px[name] = [round(float(px[0]), 1), round(float(px[1]), 1)]
        print(f"{name}: {corners_px[name]}")

    out = {
        "referenceTimeSec": spec["referenceTimeSec"],
        "corners": corners_px,
        "courtSize": {"width": COURT_W, "length": COURT_L},
        "fitRmsMeters": round(float(np.sqrt((r ** 2).mean())), 4),
    }
    json.dump(out, open(args.out_corners, "w"), indent=2)

    # ---- verification overlay: project court grid into the image ----
    img = cv2.imread(args.frame)
    def draw_court_line(cA, cB, color, thick=2):
        seg = np.linspace(cA, cB, 40)
        px = project(Hinv, seg)
        for i in range(len(px) - 1):
            a = (int(px[i][0]), int(px[i][1]))
            b = (int(px[i + 1][0]), int(px[i + 1][1]))
            cv2.line(img, a, b, color, thick, cv2.LINE_AA)

    red = (0, 0, 255); cyan = (255, 255, 0); yellow = (0, 255, 255)
    draw_court_line((0, 0), (COURT_W, 0), red)                  # front wall base
    draw_court_line((0, COURT_L), (COURT_W, COURT_L), red)      # back wall base
    draw_court_line((0, 0), (0, COURT_L), red)                  # left wall base
    draw_court_line((COURT_W, 0), (COURT_W, COURT_L), red)      # right wall base
    draw_court_line((0, SHORT_Y), (COURT_W, SHORT_Y), cyan)     # short line
    draw_court_line((COURT_W / 2, SHORT_Y), (COURT_W / 2, COURT_L), cyan)  # half-court line
    for x0 in (0.0, COURT_W - BOX):                             # service boxes
        draw_court_line((x0, SHORT_Y), (x0 + BOX, SHORT_Y), yellow, 1)
        draw_court_line((x0, SHORT_Y + BOX), (x0 + BOX, SHORT_Y + BOX), yellow, 1)
        draw_court_line((x0 + BOX, SHORT_Y), (x0 + BOX, SHORT_Y + BOX), yellow, 1)
        draw_court_line((x0, SHORT_Y), (x0, SHORT_Y + BOX), yellow, 1)
    # T marker
    t_px = project(Hinv, [(COURT_W / 2, SHORT_Y)])[0]
    cv2.circle(img, (int(t_px[0]), int(t_px[1])), 6, (255, 0, 255), -1)
    cv2.imwrite(args.out_overlay, img)
    print("overlay ->", args.out_overlay)


if __name__ == "__main__":
    main()
