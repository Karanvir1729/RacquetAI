#!/usr/bin/env python3
"""A LABELLING AID, not a detector. It makes no decisions and emits no candidates.

Three consecutive frames are ORB-aligned to the middle one (same trick
analyze.py uses to survive the handheld pan; here the baseline is one frame, so
a single direct homography is enough and no anchor chaining is needed) and then
packed into one RGB image: R = t-1, G = t, B = t+1, of the grayscale. Anything
that did not move is grey. A dark object that moved leaves a coloured trail —
cyan where it has just left, magenta-ish where it is about to be.

WHY THIS EXISTS, AND THE BIAS IT CARRIES
    A human labelling video scrubs back and forth; motion is most of how the eye
    finds a 3 px ball at all. Denying the labeller temporal context would
    understate what a human can do. But this composite is arithmetically a frame
    difference, so any ball found ONLY through it is, by construction, a ball a
    differencing detector could also have found. Grading such a detector on
    those labels is close to circular.

    The labelling protocol therefore records, per frame, HOW the ball was found:
      "raw"      seen unaided in the single still  -> the strict human ceiling
      "temporal" only found once motion was shown  -> the realistic ceiling,
                                                      and diff-flavoured
    Every position is confirmed by eye in the RAW magnified pixels before it is
    written down; the aid only says where to look. Frames called notVisible are
    called that after searching the raw frame, not after the aid came up empty.

    .venv/bin/python tools/ball_motion_aid.py --video samples/archive_match3.mp4 \
        --frame 6532 --outdir /tmp/ball --tag m3
"""
import argparse
import os

import cv2
import numpy as np

MAX_W, MAX_H = 1500, 1150
CAPTION_H = 26
FONT = cv2.FONT_HERSHEY_SIMPLEX


def read_window(video, center, half=1):
    cap = cv2.VideoCapture(video)
    start = max(0, center - half)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    out = {}
    for k in range(2 * half + 1):
        ok, fr = cap.read()
        if not ok:
            break
        out[start + k] = fr
    cap.release()
    return out


def align(src, dst):
    """Homography-warp src into dst's frame. Falls back to src unchanged."""
    orb = cv2.ORB_create(2500)
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    ga = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(dst, cv2.COLOR_BGR2GRAY)
    ka, da = orb.detectAndCompute(ga, None)
    kb, db = orb.detectAndCompute(gb, None)
    if da is None or db is None or len(ka) < 30 or len(kb) < 30:
        return src, 0
    mt = m.match(da, db)
    if len(mt) < 30:
        return src, 0
    mt = sorted(mt, key=lambda x: x.distance)[:600]
    p = np.float32([ka[x.queryIdx].pt for x in mt]).reshape(-1, 1, 2)
    q = np.float32([kb[x.trainIdx].pt for x in mt]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(p, q, cv2.RANSAC, 3.0)
    if H is None:
        return src, 0
    h, w = dst.shape[:2]
    return cv2.warpPerspective(src, H, (w, h)), int(mask.sum())


def composite(video, center):
    fr = read_window(video, center, 1)
    if center not in fr:
        raise SystemExit(f"frame {center} unavailable")
    mid = fr[center]
    prev = fr.get(center - 1, mid)
    nxt = fr.get(center + 1, mid)
    pa, np_in = align(prev, mid)
    na, nn_in = align(nxt, mid)
    g = lambda im: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    # BGR channel order: B = t+1, G = t, R = t-1
    rgb = cv2.merge([g(na), g(mid), g(pa)])
    return mid, rgb, np_in, nn_in


def trail(video, start, n):
    """Aligned dark-residual max over n frames: the ball's whole flight as an arc.

    Calibration display only. It answers "is the ball in the pixels at all, and
    where does it go", which is what a labeller needs before hunting frame by
    frame. It is emphatically not a per-frame label: a bright arc here says the
    ball existed somewhere in these n frames, not that it is visible in any one.
    """
    cap = cv2.VideoCapture(video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    frames = []
    for _ in range(n):
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if not frames:
        raise SystemExit("no frames")
    ref = frames[len(frames) // 2]
    warped = []
    for fr in frames:
        w, _ = align(fr, ref)
        warped.append(cv2.cvtColor(w, cv2.COLOR_BGR2GRAY).astype(np.int16))
    stack = np.stack(warped)
    bg = np.median(stack, axis=0)
    dark = np.clip(bg - stack, 0, 255).max(axis=0).astype(np.uint8)
    base = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    out = cv2.cvtColor((base // 2).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    heat = cv2.applyColorMap(cv2.normalize(dark, None, 0, 255, cv2.NORM_MINMAX),
                             cv2.COLORMAP_INFERNO)
    m = (dark > 18)[..., None]
    return np.where(m, heat, out)


def multi(video, frames, crop):
    """2x2 grid of RGB composites, same crop, so one read pins many frames.

    Each composite resolves three frames by colour (cyan = t-1, magenta = t,
    yellow = t+1), so centres at t0+1, +4, +7, +10 cover a 12-frame segment
    completely. Purely a look-here map; visibility is still judged on the raw
    magnified crop afterwards.
    """
    x0, y0, w, h = crop
    tiles = []
    for f in frames:
        _, rgb, _, _ = composite(video, f)
        H, W = rgb.shape[:2]
        cx, cy = max(0, min(x0, W - 1)), max(0, min(y0, H - 1))
        sub = rgb[cy:cy + min(h, H - cy), cx:cx + min(w, W - cx)]
        z = min(660 / sub.shape[1], 500 / sub.shape[0])
        t = cv2.resize(sub, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
        t = cap_bar(t, f"f{f}  cyan=f{f - 1} magenta=f{f} yellow=f{f + 1}  "
                       f"origin ({cx},{cy}) z={z:.1f}x")
        cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), (0, 255, 255), 1)
        tiles.append(t)
    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + 1) // 2
    canvas = np.zeros((rows * th, 2 * tw, 3), np.uint8)
    for k, t in enumerate(tiles):
        r, c = divmod(k, 2)
        canvas[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = t
    return canvas


def cap_bar(img, text):
    bar = np.zeros((CAPTION_H, img.shape[1], 3), np.uint8)
    bar[:] = (40, 40, 40)
    cv2.putText(bar, text, (6, 18), FONT, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--frame", type=int, required=True)
    ap.add_argument("--crop", default=None, help="x0,y0,w,h in source pixels")
    ap.add_argument("--multi", action="store_true",
                    help="2x2 composites at +1/+4/+7/+10; needs --crop")
    ap.add_argument("--trail", type=int, default=0,
                    help="calibration: dark-residual max over N frames from --frame")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--tag", default="aid")
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)

    if a.multi:
        crop = [int(v) for v in a.crop.split(",")]
        img = multi(a.video, [a.frame + k for k in (1, 4, 7, 10)], crop)
        p = os.path.join(a.outdir, f"{a.tag}_multi_f{a.frame}.png")
        cv2.imwrite(p, img)
        print(p)
        return

    if a.trail:
        img = trail(a.video, a.frame, a.trail)
        ox = oy = 0
        if a.crop:
            ox, oy, w, h = (int(v) for v in a.crop.split(","))
            H, W = img.shape[:2]
            ox, oy = max(0, min(ox, W - 1)), max(0, min(oy, H - 1))
            img = img[oy:oy + min(h, H - oy), ox:ox + min(w, W - ox)]
        z = min(MAX_W / img.shape[1], MAX_H / img.shape[0])
        view = cv2.resize(img, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
        view = cap_bar(view, f"{a.tag} TRAIL f{a.frame}..{a.frame + a.trail - 1} "
                             f"dark residual max  origin ({ox},{oy})  zoom {z:.2f}x "
                             f" CALIBRATION ONLY")
        p = os.path.join(a.outdir, f"{a.tag}_trail_f{a.frame}.png")
        cv2.imwrite(p, view)
        print(p)
        return

    mid, rgb, ni, nn = composite(a.video, a.frame)
    x0 = y0 = 0
    if a.crop:
        x0, y0, w, h = (int(v) for v in a.crop.split(","))
        H, W = mid.shape[:2]
        x0, y0 = max(0, min(x0, W - 1)), max(0, min(y0, H - 1))
        w, h = min(w, W - x0), min(h, H - y0)
        rgb = rgb[y0:y0 + h, x0:x0 + w]
    z = min(MAX_W / rgb.shape[1], MAX_H / rgb.shape[0])
    view = cv2.resize(rgb, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
    view = cap_bar(view, f"{a.tag} AID f{a.frame}  R=t-1 G=t B=t+1  "
                         f"origin ({x0},{y0}) zoom {z:.2f}x  inliers {ni}/{nn}")
    p = os.path.join(a.outdir, f"{a.tag}_aid_f{a.frame}.png")
    cv2.imwrite(p, view)
    print(p)


if __name__ == "__main__":
    main()
