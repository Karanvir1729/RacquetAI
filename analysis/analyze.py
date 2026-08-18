#!/usr/bin/env python3
"""RacquetAI v0 squash shot-placement analysis pipeline.

Usage:
    analyze.py --video samples/clip.mp4 --corners samples/clip.corners.json --out out/clip

Stages:
  1. Decode + sample ~8 fps.
  2. Per-frame ORB alignment to a reference frame (handles handheld camera drift),
     composed with a hand-calibrated floor homography (pixels -> court meters).
  3. RTMPose (rtmlib, CPU) 2-person pose; nearest-neighbor 2-ID tracking with swap guard.
  4. Shot moments from audio onsets (librosa spectral flux; wrist-speed peaks if no
     audio), kept only where a player swung AND a rally was in progress on this court.
  5. Placement via retrieval proxy: shot k lands where the opponent strikes shot k+1.
  6. Shot type from the striker/landing geometry plus wrist-above-shoulder at contact.
  7. Analytics per player + verification artifacts + analysis.json (schemaVersion 2:
     adds `tracks`, the sampled pose keypoints the app draws as a skeleton overlay,
     and `type`/`typeConfidence` on every shot).

Court frame: x in [0, 6.4] (0 = left wall), y in [0, 9.75] (0 = front wall).
"""
import argparse
import json
import math
import os
import pickle
import subprocess
import sys

import cv2
import numpy as np

COURT_W = 6.4
COURT_L = 9.75
SHORT_Y = 5.44
MID_X = COURT_W / 2.0
T_POS = (MID_X, SHORT_Y)
T_RADIUS = 1.5
HEAT_ROWS, HEAT_COLS = 12, 8
SAMPLE_FPS = 8.0
ONSET_MERGE_S = 0.35
ONSET_HEIGHT_F = 1.0   # peak height above the median, in (p95 - median) units
ONSET_PROM_F = 0.5     # minimum peak prominence, same units
RALLY_GAP_S = 8.0
WRIST_WIN_S = 0.30
# rally-activity gate (see rally_activity): the threshold is a percentile of
# the clip's OWN activity distribution, because the signal is measured in
# bbox-heights/sec and an absolute cut does not survive a change of camera
# framing — tuned per-clip thresholds did not transfer between the three
# archive matches, percentile ones did.
RALLY_WIN_S = 1.5      # half-width of the activity window
RALLY_ACT_Q = 65.0     # keep onsets in the busiest 35% of the clip
RALLY_MIN_OBS = 3      # wrist samples needed before a player's median counts
STRONG_SWING_F = 1.2   # x the clip's p90 swing peak: overrides the gate outright
MIN_ALIGN_INLIERS = 25
KPT_CONF = 0.3
COURT_MARGIN = 0.8  # meters of slack when filtering detections to the court

# schema v2 shot classification (see the schema v2 spec — the app and the Swift
# engine implement the same thresholds, so these must not drift)
TRACK_HZ = 8.0
N_KPTS = 17
FRONT_THIRD_Y = 3.25   # landing this far up the court is a front-court shot
DEEP_Y = 6.5           # landing/striking behind this is the back third
POSE_CONF_LOW = 0.25   # below this the court position is only a rough fix.
                       # Calibrated to the ankle-score distribution this
                       # pipeline actually produces (median ~0.35): the old
                       # 0.5 sat above p75 and flagged nearly every shot,
                       # which made typeConfidence a constant carrying no signal.
SHOT_BASE_CONF = 0.8

# ---- appearance re-identification (shared spec with the Swift engine) ----
# Torso patch geometry, in units of the subject's own torso length, so the patch
# shrinks with distance instead of swallowing the background at the back wall.
APP_CENTER_F = 0.45     # patch centre, fraction of the way shoulders -> hips
APP_HALF_H_F = 0.34     # half-height = this x torso length
APP_HALF_W_F = 0.36     # half-width  = this x effective shoulder width
APP_MIN_SHO_W_F = 0.35  # shoulders seen edge-on collapse to ~0 px wide; floor the
                        # width at this x torso length so the patch never degenerates
APP_MIN_TORSO_PX = 8.0  # below this the torso is too few pixels to characterise
APP_MIN_PIXELS = 24     # clipped patch must still hold this many pixels
APP_MIN_INSIDE = 0.5    # ... and this fraction of its unclipped area
# Descriptor = (r, g, L): rg-chromaticity of the patch median plus its luma
# relative to the frame's own exposure. Chromaticity is already invariant to
# illumination scale; L is invariant to a global auto-exposure shift.
APP_CHROMA_W = 32.0     # 1 / the within-person spread of each component, averaged
APP_LUMA_W = 2.6        # over the three audit clips (tools/identity_audit.py
                        # --calibrate). For two classes with roughly diagonal
                        # covariance, standardising this way makes plain
                        # Euclidean distance the right discriminant.
                        # Keep BOTH halves: luma usually carries the most
                        # (per-clip separability 5.1 / 1.6 / 6.3) because these
                        # players wear dark navy against white, but on the clip
                        # where luma is weakest, chroma is the strongest single
                        # component (r = 2.1 against luma's 1.6). Colour is what
                        # rescues two players of similar brightness.
APP_LAMBDA = 0.5        # appearance weight in the association cost. Swept against
                        # an oracle-primed association test over all three clips
                        # (tools/identity_audit.py --calibrate): re-acquisition
                        # error after an occlusion gap falls from 15.5% at
                        # lambda=0 to a flat 2.2-2.7% plateau spanning 0.2-1.5,
                        # while adjacent frames stay at 1 error in 4365. 0.5 is
                        # the centre of that plateau rather than the grid minimum
                        # (0.35, better by 2 decisions in 1018 -- noise), so the
                        # value does not depend on where the grid was sampled.
APP_EMA_ALPHA = 0.05    # template EMA rate: ~20 samples (2.5 s) time constant
APP_SEP_MIN_M = 1.2     # players must be this far apart on court to trust identity
APP_BOX_OVERLAP_MAX = 0.15   # ... and their pixel boxes may not overlap more
APP_MARGIN_MIN = 0.35        # ... and the keep/swap decision must be this decisive
APP_LEARN_MARGIN = 0.0       # ... and the detection must already look more like the
                             # template it is about to update than like the other one
POS_SCALE_M = 0.75      # metres of plausible motion between samples at 8 fps
POS_SPEED_MS = 3.0      # position uncertainty growth while an identity is unseen
POS_NEUTRAL = 3.0       # cost charged against an identity with no known position

# NUL cannot appear in any value this pipeline emits, so the placeholder that
# holds `tracks` open during pretty-printing can never collide with real data
TRACKS_TOKEN = "\u0000tracks\u0000"

# COCO-17 indices
L_SHO, R_SHO, L_HIP, R_HIP = 5, 6, 11, 12
L_WRI, R_WRI = 9, 10
L_ANK, R_ANK = 15, 16
BONES = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (5, 11), (6, 12), (11, 12),
         (11, 13), (13, 15), (12, 14), (14, 16), (0, 5), (0, 6)]


def cell_of(x, y):
    fx = "front" if y < SHORT_Y else "back"
    side = "Left" if x < MID_X else "Right"
    return fx + side


def project(H, pts):
    pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    ones = np.ones((len(pts), 1))
    ph = (H @ np.hstack([pts, ones]).T).T
    return ph[:, :2] / ph[:, 2:3]


def extract_frame(cap, t_sec):
    cap.set(cv2.CAP_PROP_POS_MSEC, t_sec * 1000)
    ok, frame = cap.read()
    return frame if ok else None


# ---------------------------------------------------------------- alignment
ANCHOR_MIN_INLIERS = 80  # direct match strength needed to (re-)anchor to the ref


def _fit_h(kp_a, desc_a, kp_b, desc_b, matcher):
    """Homography mapping a -> b from ORB descriptors, or (None, 0)."""
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


class FrameAligner:
    """Per-frame ORB features; direct match to the reference frame plus a
    sequential step match to the previous sampled frame.

    A single wide-baseline homography mixes the back-glass plane with the floor
    plane once a handheld camera translates, so the final alignment is built by
    chaining small steps from the nearest strongly-anchored frame instead
    (see build_alignments)."""

    def __init__(self, ref_img):
        self.orb = cv2.ORB_create(2500)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        g = cv2.cvtColor(ref_img, cv2.COLOR_BGR2GRAY)
        self.ref_kp, self.ref_desc = self.orb.detectAndCompute(g, None)
        self.prev = None  # (kp, desc)

    def observe(self, frame):
        """Return (H_direct, direct_inliers, H_step) for this frame.
        H_step maps this frame -> previous sampled frame."""
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        kp, desc = self.orb.detectAndCompute(g, None)
        H_dir, n_dir = _fit_h(kp, desc, self.ref_kp, self.ref_desc, self.matcher)
        H_step = None
        if self.prev is not None:
            H_step, n_step = _fit_h(kp, desc, self.prev[0], self.prev[1], self.matcher)
            if n_step < MIN_ALIGN_INLIERS:
                H_step = None
        self.prev = (kp, desc)
        return H_dir, n_dir, H_step


def build_alignments(directs, steps):
    """Combine per-frame direct/step observations into final frame->ref maps.

    Frames whose direct match has >= ANCHOR_MIN_INLIERS become anchors; other
    frames chain step homographies from the nearest anchor (forward and
    backward sweeps, fewest chained steps wins). Returns (H_list, anchored_pct).
    """
    n = len(directs)
    INF = 10 ** 9
    fwd = [None] * n
    fwd_d = [INF] * n
    cur, dist = None, INF
    for i in range(n):
        H_dir, n_dir = directs[i]
        if H_dir is not None and n_dir >= ANCHOR_MIN_INLIERS:
            cur, dist = H_dir, 0
        elif cur is not None and steps[i] is not None:
            cur = cur @ steps[i]          # prev->ref  o  cur->prev
            cur = cur / cur[2, 2]
            dist += 1
        elif cur is not None:
            dist += 25                    # missing step: heavy penalty
        fwd[i], fwd_d[i] = cur, dist
    bwd = [None] * n
    bwd_d = [INF] * n
    cur, dist = None, INF
    for i in range(n - 1, -1, -1):
        H_dir, n_dir = directs[i]
        if H_dir is not None and n_dir >= ANCHOR_MIN_INLIERS:
            cur, dist = H_dir, 0
        elif cur is not None:
            if i + 1 < n and steps[i + 1] is not None:
                cur = cur @ np.linalg.inv(steps[i + 1])   # next->ref o cur->next
                cur = cur / cur[2, 2]
                dist += 1
            else:
                dist += 25
        bwd[i], bwd_d[i] = cur, dist
    out = []
    anchored = 0
    for i in range(n):
        if fwd_d[i] <= bwd_d[i] and fwd[i] is not None:
            H, d = fwd[i], fwd_d[i]
        elif bwd[i] is not None:
            H, d = bwd[i], bwd_d[i]
        else:
            H, d = np.eye(3), INF
        out.append(H)
        if d <= 80:  # within ~10 s of an anchor at 8 fps
            anchored += 1
    return out, 100.0 * anchored / max(n, 1)


# ---------------------------------------------------------------- appearance
def frame_exposure_ref(frame):
    """Median grey level of the whole frame, the exposure the patch is read against.

    Downsampled 8x first: the median of a 107x60 image is the same number for
    this purpose and costs ~1% of the full-resolution sort.
    """
    small = cv2.resize(frame, (0, 0), fx=0.125, fy=0.125, interpolation=cv2.INTER_AREA)
    return float(np.median(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)))


def torso_patch_box(kpts, scores, width, height):
    """Axis-aligned torso patch (x0, y0, x1, y1) clipped to the frame, or None.

    Sized from the subject's own torso, so a player at the back wall and the same
    player at the front wall yield patches covering the same piece of shirt.
    """
    if any(scores[j] <= KPT_CONF for j in (L_SHO, R_SHO, L_HIP, R_HIP)):
        return None
    sho = 0.5 * (kpts[L_SHO] + kpts[R_SHO])
    hip = 0.5 * (kpts[L_HIP] + kpts[R_HIP])
    torso_len = float(np.hypot(*(hip - sho)))
    if torso_len < APP_MIN_TORSO_PX:
        return None
    cx, cy = sho + APP_CENTER_F * (hip - sho)
    sho_w = float(np.hypot(*(kpts[L_SHO] - kpts[R_SHO])))
    half_w = APP_HALF_W_F * max(sho_w, APP_MIN_SHO_W_F * torso_len)
    half_h = APP_HALF_H_F * torso_len
    x0, x1 = int(round(cx - half_w)), int(round(cx + half_w))
    y0, y1 = int(round(cy - half_h)), int(round(cy + half_h))
    full = max((x1 - x0) * (y1 - y0), 1)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return None
    inside = (x1 - x0) * (y1 - y0)
    # a patch mostly off-frame describes the frame edge, not the player
    if inside < APP_MIN_PIXELS or inside < APP_MIN_INSIDE * full:
        return None
    return x0, y0, x1, y1


def torso_appearance(frame, kpts, scores, exposure_ref):
    """Appearance descriptor (r, g, L) for one detection, or None.

    The patch is reduced by a per-channel MEDIAN: a racquet, an arm or a line of
    background crossing the patch moves a mean but not a median. (r, g) is
    rg-chromaticity, invariant to how brightly the patch happens to be lit; L is
    log luma relative to the frame's own median grey, so a camera auto-exposure
    step shifts every player equally and cancels.
    """
    h, w = frame.shape[:2]
    box = torso_patch_box(kpts, scores, w, h)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    med = np.median(frame[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    b, g, r = float(med[0]), float(med[1]), float(med[2])
    total = b + g + r
    if total < 1e-6:
        return None
    lum = total / 3.0
    return (r / total, g / total,
            float(math.log((lum + 1.0) / (max(exposure_ref, 0.0) + 1.0))))


def appearance_distance(u, v):
    """Weighted Euclidean distance between two (r, g, L) descriptors."""
    dr = APP_CHROMA_W * (u[0] - v[0])
    dg = APP_CHROMA_W * (u[1] - v[1])
    dl = APP_LUMA_W * (u[2] - v[2])
    return math.sqrt(dr * dr + dg * dg + dl * dl)


def keypoint_box(kpts, scores):
    """Pixel bounding box over confidently-placed keypoints, or None."""
    vis = kpts[scores > KPT_CONF]
    if len(vis) < 2:
        return None
    return (float(vis[:, 0].min()), float(vis[:, 1].min()),
            float(vis[:, 0].max()), float(vis[:, 1].max()))


def fill_appearance(video_path, times, raw_frames, fps, duration):
    """Add `app` to every cached detection by re-decoding the video.

    Used to upgrade a v2 pose cache without re-running pose inference. The
    sampling arithmetic is the same as pass 1's, so sampled frame j lines up with
    raw_frames[j]; that is asserted rather than assumed, because silently pairing
    a player's keypoints with a different frame's pixels would poison every
    descriptor while looking perfectly healthy.
    """
    cap = cv2.VideoCapture(video_path)
    stride = max(1, round(fps / SAMPLE_FPS))
    j = idx = 0
    while j < len(times):
        ok, frame = cap.read()
        if not ok:
            break
        if idx % stride:
            idx += 1
            continue
        t = idx / fps
        if t > duration:
            break
        if abs(t - times[j]) > 1e-6:
            cap.release()
            raise RuntimeError(
                f"pose cache does not line up with {video_path} at sample {j} "
                f"(cache t={times[j]:.4f}s, decode t={t:.4f}s). Delete "
                "pose_cache_v2.pkl and re-run to rebuild it from scratch.")
        exposure = frame_exposure_ref(frame)
        for det in raw_frames[j]:
            det["app"] = torso_appearance(frame, det["kpts"], det["scores"], exposure)
        j += 1
        idx += 1
        if j % 400 == 0:
            print(f"  ... appearance {t:.0f}s / {duration:.0f}s")
    cap.release()
    if j < len(times):
        raise RuntimeError(f"video ended after {j} of {len(times)} cached samples")
    n_app = sum(1 for f in raw_frames for d in f if d.get("app") is not None)
    n_det = sum(len(f) for f in raw_frames)
    print(f"appearance: {n_app}/{n_det} detections described "
          f"({100.0 * n_app / max(n_det, 1):.1f}%)")


def box_overlap(a, b):
    """Intersection area over the smaller box's area; 0 when either is missing.

    Overlap-over-min rather than IoU because the question is "is one player in
    front of the other", and a small player fully in front of a large one has a
    low IoU but an overlap of 1.
    """
    if a is None or b is None:
        return 0.0
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    small = min(max(a[2] - a[0], 0.0) * max(a[3] - a[1], 0.0),
                max(b[2] - b[0], 0.0) * max(b[3] - b[1], 0.0))
    return inter / small if small > 0 else 0.0


# ---------------------------------------------------------------- pose + tracking
def detect_players(raw_dets, H_px2court):
    """Filter raw pose detections to in-court players; keep the 2 biggest."""
    cands = []
    for det in raw_dets:
        k, s = det["kpts"], det["scores"]
        ank, ank_conf = [], []
        for j in (L_ANK, R_ANK):
            if s[j] > KPT_CONF:
                ank.append(k[j])
                ank_conf.append(float(s[j]))
        if not ank:
            continue
        ankle_px = np.mean(ank, axis=0)
        cx, cy = project(H_px2court, [ankle_px])[0]
        if not (-COURT_MARGIN <= cx <= COURT_W + COURT_MARGIN and
                -COURT_MARGIN <= cy <= COURT_L + COURT_MARGIN):
            continue
        vis = k[s > KPT_CONF]
        if len(vis) < 6:
            continue
        w = vis[:, 0].max() - vis[:, 0].min()
        h = vis[:, 1].max() - vis[:, 1].min()
        cands.append({
            "kpts": k, "scores": s, "ankle_px": ankle_px,
            "torso_val": det.get("torso_val"),
            "app": det.get("app"),
            "box": keypoint_box(k, s),
            "court": (float(np.clip(cx, 0, COURT_W)), float(np.clip(cy, 0, COURT_L))),
            # the court fix is only as good as the ankles it was projected from
            "pos_conf": float(np.mean(ank_conf)),
            "area": float(w * h), "bbox_h": float(h),
        })
    cands.sort(key=lambda c: -c["area"])
    return cands[:2]


class TwoTracker:
    """2-ID association by total cost over both pairings: normalised court
    distance + APP_LAMBDA x appearance distance to a per-identity template.

    Position alone is a coin flip exactly when it matters — the moment two
    players cross or occlude each other — and a wrong call there persists,
    because the next frame's position prior now agrees with the mistake. The
    shirt does not become ambiguous during a crossing, so appearance is what
    breaks the tie. Templates are learned only on frames where identity is not
    in doubt, so an ambiguous overlap can never teach a template the wrong
    player and make the swap permanent.
    """

    def __init__(self):
        self.pos = {"A": None, "B": None}
        self.seen_t = {"A": None, "B": None}   # time of that position fix
        self.tmpl = {"A": None, "B": None}     # EMA appearance template

    def update(self, dets, t=None):
        out = {}
        if len(dets) == 0:
            return out
        if self.pos["A"] is None and self.pos["B"] is None:
            # first sight: leftmost player becomes A (unchanged convention)
            dets = sorted(dets, key=lambda d: d["court"][0])
            out["A"] = dets[0]
            if len(dets) > 1:
                out["B"] = dets[1]
            if len(out) == 2 and self._unoccluded(out["A"], out["B"]):
                # nothing to protect yet: at first sight the convention *defines*
                # which player is A, so these descriptors cannot be the wrong ones
                for pid, d in out.items():
                    self.tmpl[pid] = d["app"]
        elif len(dets) == 1:
            d = dets[0]
            # appearance only helps here if it can speak about both identities
            use_app = d["app"] is not None and all(self.tmpl[p] is not None
                                                   for p in ("A", "B"))
            ca = self._cost("A", d, t, use_app)
            cb = self._cost("B", d, t, use_app)
            out["A" if ca <= cb else "B"] = d
        else:
            d0, d1 = dets[0], dets[1]
            # Include the appearance term only where it is symmetric across the
            # two pairings. With two templates it compares one detection against
            # both identities; with two descriptors it compares one identity
            # against both detections. With one of each the term would appear in
            # `keep` and not in `swap`, which is a bias, not evidence.
            use_app = (all(d["app"] is not None for d in (d0, d1))
                       or all(self.tmpl[p] is not None for p in ("A", "B")))
            keep = (self._cost("A", d0, t, use_app) + self._cost("B", d1, t, use_app))
            swap = (self._cost("A", d1, t, use_app) + self._cost("B", d0, t, use_app))
            if swap < keep:
                out["A"], out["B"] = d1, d0
            else:
                out["A"], out["B"] = d0, d1
            if abs(keep - swap) >= APP_MARGIN_MIN and self._unoccluded(out["A"], out["B"]):
                self._learn(out)
        for pid, d in out.items():
            self.pos[pid] = d["court"]
            self.seen_t[pid] = t
        return out

    def _unoccluded(self, da, db):
        """Is this a frame where the two detections are unambiguously two people?"""
        if da["app"] is None or db["app"] is None:
            return False
        if math.hypot(da["court"][0] - db["court"][0],
                      da["court"][1] - db["court"][1]) < APP_SEP_MIN_M:
            return False
        return box_overlap(da.get("box"), db.get("box")) <= APP_BOX_OVERLAP_MAX

    def _learn(self, out):
        """EMA the templates towards this frame -- but only if appearance already
        agrees with the assignment.

        Being unoccluded says the two detections are two different people; it does
        not say the labels are on the right ones. If the tracker is running
        swapped, every frame after the swap looks perfectly clean, and a template
        that learns from those frames walks onto the other player within a couple
        of seconds and makes the swap permanent -- the exact failure this whole
        change exists to remove. So a detection may only teach a template it
        already resembles more than it resembles the other one; when the labels
        are wrong the templates simply stop learning, stay correct, and go on
        voting to swap back at the next re-acquisition.
        """
        other = {"A": "B", "B": "A"}
        for pid, d in out.items():
            mine = self.tmpl[pid]
            if mine is None:
                self.tmpl[pid] = d["app"]
                continue
            theirs = self.tmpl[other[pid]]
            if theirs is not None:
                if (appearance_distance(d["app"], mine) + APP_LEARN_MARGIN
                        > appearance_distance(d["app"], theirs)):
                    continue
            a = APP_EMA_ALPHA
            self.tmpl[pid] = tuple((1.0 - a) * mine[i] + a * d["app"][i]
                                   for i in range(3))

    def _cost(self, pid, det, t, use_app):
        cost = self._pos_cost(pid, det, t)
        if use_app and det["app"] is not None and self.tmpl[pid] is not None:
            cost += APP_LAMBDA * appearance_distance(det["app"], self.tmpl[pid])
        return cost

    def _pos_cost(self, pid, det, t):
        """Court distance in units of how far this identity could plausibly have
        moved since it was last seen — a 2 m jump is damning after 1/8 s and
        meaningless after 4 s of being lost behind the other player."""
        p = self.pos[pid]
        if p is None:
            return POS_NEUTRAL
        q = det["court"]
        gap = 0.0
        if t is not None and self.seen_t[pid] is not None:
            gap = max(0.0, t - self.seen_t[pid])
        return math.hypot(p[0] - q[0], p[1] - q[1]) / (POS_SCALE_M + POS_SPEED_MS * gap)


# ---------------------------------------------------------------- audio
def extract_audio(video_path, tmp_dir):
    wav = os.path.join(tmp_dir, "audio.wav")
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", video_path, "-vn", "-ac", "1",
         "-ar", "22050", wav],
        capture_output=True)
    if r.returncode != 0 or not os.path.exists(wav) or os.path.getsize(wav) < 1024:
        return None
    return wav


def audio_onsets(wav):
    """Spectral-flux onset envelope + adaptive peak picking.

    librosa.onset_detect's local-average delta collapses on continuously noisy
    audio (multi-court venues), so peaks are picked directly: height above an
    adaptive threshold, minimum prominence, minimum separation ONSET_MERGE_S.
    """
    import librosa
    from scipy.signal import find_peaks
    y, sr = librosa.load(wav, sr=22050, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=sr)
    env_t = librosa.times_like(env, sr=sr)
    frame_dt = float(env_t[1] - env_t[0])
    med = float(np.median(env))
    p95 = float(np.percentile(env, 95))
    thr = med + ONSET_HEIGHT_F * (p95 - med)
    peaks, _ = find_peaks(env, height=thr, prominence=ONSET_PROM_F * (p95 - med),
                          distance=max(1, int(round(ONSET_MERGE_S / frame_dt))))
    return [float(t) for t in env_t[peaks]], (env_t, env)


def wrist_speed_onsets(track_frames, times):
    """No-audio fallback: peaks of max wrist speed across both players."""
    speeds = []
    prev = {}
    for i, tf in enumerate(track_frames):
        best = 0.0
        for pid, d in tf.items():
            for j in (L_WRI, R_WRI):
                if d["scores"][j] > KPT_CONF:
                    cur = d["kpts"][j]
                    key = (pid, j)
                    if key in prev:
                        v = np.hypot(*(cur - prev[key][0])) / max(times[i] - prev[key][1], 1e-6)
                        v /= max(d["bbox_h"], 1.0)  # scale-invariant
                        best = max(best, v)
                    prev[key] = (cur, times[i])
        speeds.append(best)
    speeds = np.array(speeds)
    if speeds.max() <= 0:
        return [], (np.array(times), speeds)
    thr = max(np.percentile(speeds, 75), speeds.max() * 0.35)
    onsets = []
    for i in range(1, len(speeds) - 1):
        if speeds[i] >= thr and speeds[i] >= speeds[i - 1] and speeds[i] >= speeds[i + 1]:
            t = times[i]
            if onsets and t - onsets[-1] < ONSET_MERGE_S:
                continue
            onsets.append(float(t))
    return onsets, (np.array(times), speeds)


# ---------------------------------------------------------------- striker attribution
def peak_wrist_speed(track_frames, times, idx_lo, idx_hi, pid):
    """Peak scale-normalized wrist speed (bbox-heights/sec) in a window.

    Racquet swings measured on real footage peak at 2-5, ball-bouncing /
    walking between rallies at 0.5-1.9 — this is the swing discriminator.
    Returns (peak, n_obs)."""
    best, obs = 0.0, 0
    prev = {}
    for i in range(idx_lo, idx_hi + 1):
        d = track_frames[i].get(pid)
        if d is None:
            continue
        for j in (L_WRI, R_WRI):
            if d["scores"][j] > KPT_CONF:
                cur = d["kpts"][j]
                if j in prev:
                    dt = times[i] - prev[j][1]
                    if 0 < dt < 0.4:
                        v = float(np.hypot(*(cur - prev[j][0]))) / max(d["bbox_h"], 1.0) / dt
                        best = max(best, v)
                        obs += 1
                prev[j] = (cur, times[i])
    return best, obs


def nearest_tracked(track_frames, times, t, pid, max_dt=0.6):
    best_i, best_dt = None, max_dt
    for i, ti in enumerate(times):
        dt = abs(ti - t)
        if dt < best_dt and pid in track_frames[i]:
            best_i, best_dt = i, dt
    return best_i


# ---------------------------------------------------------------- rally activity
def wrist_speed_frames(track_frames, times):
    """Per-pose-frame scale-normalized wrist speed for each player.

    Same measurement as peak_wrist_speed (per-joint previous observation,
    bbox-height normalized, gaps over 0.4 s ignored) but kept as a time series
    instead of a window maximum. NaN where no wrist was seen.
    """
    out = {}
    for pid in ("A", "B"):
        prev = {}
        vals = np.full(len(times), np.nan)
        for i in range(len(times)):
            d = track_frames[i].get(pid)
            if d is None:
                continue
            best = np.nan
            for j in (L_WRI, R_WRI):
                if d["scores"][j] > KPT_CONF:
                    cur = d["kpts"][j]
                    if j in prev:
                        dt = times[i] - prev[j][1]
                        if 0 < dt < 0.4:
                            v = (float(np.hypot(*(cur - prev[j][0])))
                                 / max(d["bbox_h"], 1.0) / dt)
                            best = v if np.isnan(best) else max(best, v)
                    prev[j] = (cur, times[i])
            vals[i] = best
        out[pid] = vals
    return out


def rally_activity(track_frames, times):
    """How hard BOTH players are working, per pose frame.

    An audio onset is only a shot on THIS court if somebody here is playing a
    rally. Between points the players drift, bounce the ball and walk, while
    the microphone keeps hearing racquet strikes from neighbouring courts —
    which is what the wrist-peak gate cannot reject, because those onsets sit
    next to a player whose arm happens to be moving.

    Sustained two-player effort separates the two states far better than any
    instantaneous swing measure: the statistic is the median wrist speed over
    +/-RALLY_WIN_S for each player, then the MINIMUM over the two, so one
    player pacing about while the other stands still does not qualify.
    A player who is untracked across the whole window is ignored rather than
    scored zero, so a tracking dropout cannot veto a real rally.
    """
    per = wrist_speed_frames(track_frames, times)
    t = np.asarray(times)
    lo = np.searchsorted(t, t - RALLY_WIN_S)
    hi = np.searchsorted(t, t + RALLY_WIN_S)
    act = np.zeros(len(times))
    for i in range(len(times)):
        seen = []
        for pid in ("A", "B"):
            s = per[pid][lo[i]:hi[i]]
            s = s[~np.isnan(s)]
            if len(s) >= RALLY_MIN_OBS:
                seen.append(float(np.median(s)))
        act[i] = 0.0 if not seen else (min(seen) if len(seen) == 2 else seen[0])
    return act


# ---------------------------------------------------------------- schema v2: tracks
def build_tracks(times, track_frames, width, height):
    """Sampled COCO-17 keypoints for the app's skeleton overlay.

    Coordinates are normalized against the analysed frame so the app can scale
    them onto whatever size it renders the video at, and rounded to 3 dp because
    at 8 Hz x 2 players x 51 numbers the raw floats would dominate a file the
    phone has to keep on disk. Keypoints the pose model places just outside the
    frame are clamped rather than dropped — the app draws the skeleton inside
    the video box, and a limb at -0.02 would land on the surrounding chrome.
    """
    if width <= 0 or height <= 0:
        return []
    # the sampler targets SAMPLE_FPS but lands wherever the source fps divides,
    # so decimate only when it overshoots 8 Hz by a real margin
    min_dt = 0.75 / TRACK_HZ
    out, last_t = [], None
    for i, t in enumerate(times):
        if last_t is not None and t - last_t < min_dt:
            continue
        players = []
        for pid in ("A", "B"):
            det = track_frames[i].get(pid)
            if det is None:
                continue
            k, s = det["kpts"], det["scores"]
            if len(k) < N_KPTS or len(s) < N_KPTS:
                continue
            flat = []
            for j in range(N_KPTS):
                # _unit() and not a bare clamp: min/max PROPAGATE nan, and
                # json.dumps then writes a bare NaN token — Python reads that
                # back happily but the app's JSON.parse throws on it, which
                # would make the whole analysis unopenable on the phone.
                flat.append(_unit(float(k[j][0]) / width if width else 0.0))
                flat.append(_unit(float(k[j][1]) / height if height else 0.0))
                flat.append(_unit(s[j]))
            players.append({"id": pid, "k": flat})
        if not players:
            continue  # nobody detected: a sample with an empty p[] is pure overhead
        out.append({"t": round(float(t), 3), "p": players})
        last_t = t
    return out


# ---------------------------------------------------------------- schema v2: shot type
def high_contact(det):
    """Did the striker meet the ball above the shoulder? — the volley signature.

    Image y grows downward, so "above" is the smaller y. Only the higher of the
    two wrists matters; a shoulder hidden behind the body falls back to the
    other one, which is close enough for an above/below test.
    """
    k, s = det["kpts"], det["scores"]
    if len(k) < N_KPTS or len(s) < N_KPTS:
        return False
    pair = None
    for wri, sho in ((L_WRI, L_SHO), (R_WRI, R_SHO)):
        if s[wri] >= KPT_CONF and (pair is None or k[wri][1] < k[pair[0]][1]):
            pair = (wri, sho)
    if pair is None:
        return False
    wri, sho = pair
    if s[sho] < KPT_CONF:
        sho = R_SHO if sho == L_SHO else L_SHO
        if s[sho] < KPT_CONF:
            return False
    return float(k[wri][1]) < float(k[sho][1])


def _unit(value):
    """Clamp to [0, 1], mapping non-finite input to 0 so the JSON stays valid."""
    v = float(value)
    if not math.isfinite(v):
        return 0.0
    return round(min(max(v, 0.0), 1.0), 3)


def _half(x):
    """-1 / 0 / +1 relative to the half-court line."""
    return (x > MID_X) - (x < MID_X)


def classify_shot(is_serve, contact_high, striker, land):
    """Shot type from the striker/landing geometry, per the schema v2 rules.

    There is deliberately no "lob" class: without ball tracking a lob and a
    drive share the same striker/landing pair, and a confident wrong label is
    worse than none.
    """
    if is_serve:
        return "serve"
    if contact_high and land is not None:
        return "volley"
    if land is None:
        return "unknown"
    sx, sy = striker
    lx, ly = land
    if ly < FRONT_THIRD_Y:
        # off the side wall from the back corner and across — that is a boast
        if sy > DEEP_Y and _half(sx) != _half(lx):
            return "boast"
        return "drop"
    if _half(sx) == 0 or _half(lx) == 0:
        # dead on the half-court line: the side that separates a drive from a
        # cross-court is exactly what we cannot read here
        return "unknown"
    # Past the front third the depth no longer changes the name — a ball driven
    # to mid-court is still a drive — so the side alone decides. Rule 5's old
    # deep-only test left ~46% of shots unlabelled on well-calibrated footage,
    # because retrieval positions cluster in the 3.25-6.5 m band it excluded.
    return "drive" if _half(sx) == _half(lx) else "crossCourt"


def shot_confidence(shot_type, striker_conf, land_conf):
    if shot_type == "unknown":
        return 0.0
    conf = SHOT_BASE_CONF
    # geometry is the whole basis of the label, so a shaky court fix at either
    # end halves the claim
    if any(c is not None and c < POSE_CONF_LOW for c in (striker_conf, land_conf)):
        conf *= 0.5
    return round(min(max(conf, 0.0), 1.0), 3)


def dump_analysis(analysis, path):
    """Write analysis.json pretty-printed, except `tracks` — one sample per line.

    indent=2 puts every number of a 51-element keypoint array on its own line,
    which inflates the file the phone stores by roughly an order of magnitude.
    """
    tracks = analysis.get("tracks")
    text = json.dumps(dict(analysis, tracks=TRACKS_TOKEN) if tracks else analysis, indent=2)
    if tracks:
        body = ",\n".join("    " + json.dumps(s, separators=(",", ":")) for s in tracks)
        text = text.replace(json.dumps(TRACKS_TOKEN), "[\n" + body + "\n  ]", 1)
    with open(path, "w") as f:
        f.write(text + "\n")


# ---------------------------------------------------------------- analytics
def entropy_predictability(cells):
    """1 - H/Hmax over the first-order transition matrix of a cell sequence."""
    names = ["frontLeft", "frontRight", "backLeft", "backRight"]
    trans = {}
    for a, b in zip(cells, cells[1:]):
        trans[(a, b)] = trans.get((a, b), 0) + 1
    n = sum(trans.values())
    hmax = math.log2(4)
    if n == 0:
        return {"score": 0.0, "entropyBits": hmax, "maxEntropyBits": hmax,
                "topPattern": "insufficient data"}
    # entropy rate: H = -sum_i pi_i sum_j P_ij log2 P_ij
    row_tot = {}
    for (a, _), c in trans.items():
        row_tot[a] = row_tot.get(a, 0) + c
    h = 0.0
    for (a, _), c in trans.items():
        p_row = c / row_tot[a]
        h += (row_tot[a] / n) * (-p_row * math.log2(p_row))
    top, cnt = max(trans.items(), key=lambda kv: kv[1])
    pct = round(100.0 * cnt / n)
    return {"score": round(1.0 - h / hmax, 3), "entropyBits": round(h, 3),
            "maxEntropyBits": round(hmax, 3),
            "topPattern": f"{top[0]} -> {top[1]} ({pct}%)"}


# ---------------------------------------------------------------- overlays
def draw_court(img, H_court2frame, color=(0, 220, 255), thick=2):
    def line(cA, cB, col, tk):
        seg = np.linspace(cA, cB, 30)
        px = project(H_court2frame, seg)
        for i in range(len(px) - 1):
            a, b = px[i].astype(int), px[i + 1].astype(int)
            cv2.line(img, tuple(a), tuple(b), col, tk, cv2.LINE_AA)
    line((0, 0), (COURT_W, 0), color, thick)
    line((0, SHORT_Y), (COURT_W, SHORT_Y), color, thick)
    line((MID_X, SHORT_Y), (MID_X, COURT_L), color, thick)
    line((0, 0), (0, COURT_L), color, 1)
    line((COURT_W, 0), (COURT_W, COURT_L), color, 1)
    line((0, COURT_L), (COURT_W, COURT_L), color, 1)


def draw_player(img, det, pid, colors):
    col = colors[pid]
    k, s = det["kpts"], det["scores"]
    for a, b in BONES:
        if s[a] > KPT_CONF and s[b] > KPT_CONF:
            cv2.line(img, tuple(k[a].astype(int)), tuple(k[b].astype(int)), col, 2, cv2.LINE_AA)
    for j in range(17):
        if s[j] > KPT_CONF:
            cv2.circle(img, tuple(k[j].astype(int)), 3, col, -1)
    ax, ay = det["ankle_px"].astype(int)
    cx, cy = det["court"]
    cv2.circle(img, (ax, ay), 6, col, 2)
    label = f"{pid} {cell_of(cx, cy)} ({cx:.1f},{cy:.1f})m"
    cv2.putText(img, label, (max(ax - 60, 4), max(ay + 24, 16)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 3, cv2.LINE_AA)
    cv2.putText(img, label, (max(ax - 60, 4), max(ay + 24, 16)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 1, cv2.LINE_AA)


def render_heatmap(grid, path, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(4.2, 6.0))
    im = ax.imshow(grid, cmap="hot", origin="upper", extent=[0, COURT_W, COURT_L, 0],
                   vmin=0, vmax=1, aspect="equal")
    ax.axhline(SHORT_Y, color="cyan", lw=1.2)
    ax.plot([MID_X, MID_X], [SHORT_Y, COURT_L], color="cyan", lw=1.2)
    ax.add_patch(plt.Circle(T_POS, T_RADIUS, fill=False, color="lime", lw=1.2))
    ax.set_title(title, fontsize=10)
    ax.set_xlabel("x (m)  0 = left wall")
    ax.set_ylabel("y (m)  0 = front wall")
    fig.colorbar(im, ax=ax, shrink=0.7)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--corners", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-sec", type=float, default=None, help="analyze only first N seconds")
    ap.add_argument("--rally-gap", type=float, default=RALLY_GAP_S,
                    help="silence gap (s) between attributed shots that ends a rally")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    notes = []

    corners = json.load(open(args.corners))
    meta_path = os.path.splitext(args.video)[0] + ".meta.json"
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = n_frames / fps
    if args.max_sec:
        duration = min(duration, args.max_sec)

    # reference frame + homographies
    ref = extract_frame(cap, corners["referenceTimeSec"])
    if ref is None:
        sys.exit("cannot read reference frame")
    c = corners["corners"]
    src = np.float32([c["frontLeft"], c["frontRight"], c["backLeft"], c["backRight"]])
    dst = np.float32([[0, 0], [COURT_W, 0], [0, COURT_L], [COURT_W, COURT_L]])
    H_ref2court = cv2.getPerspectiveTransform(src, dst)

    # ---------------- pass 1: pose + alignment observations (cached) ----------------
    # v3 = v2 plus the per-detection appearance descriptor. The filename carries
    # the version so a v2 cache, which has no descriptors, can never be picked up
    # silently and quietly turn the tracker back into position-only.
    cache_path = os.path.join(args.out, "pose_cache_v3.pkl")
    legacy_path = os.path.join(args.out, "pose_cache_v2.pkl")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            blob = pickle.load(f)
        times, raw_frames = blob["times"], blob["raw_frames"]
        directs, steps = blob["directs"], blob["steps"]
        print(f"pose cache hit: {len(times)} frames")
    elif os.path.exists(legacy_path):
        # Upgrade in place: pose inference is the expensive half (~20 min/clip)
        # and it is already done; only the pixels are missing, so re-decode and
        # read the descriptors off the frames the cached keypoints point at.
        with open(legacy_path, "rb") as f:
            blob = pickle.load(f)
        times, raw_frames = blob["times"], blob["raw_frames"]
        directs, steps = blob["directs"], blob["steps"]
        print(f"pose cache v2 hit: {len(times)} frames; adding appearance ...")
        fill_appearance(args.video, times, raw_frames, fps, duration)
        with open(cache_path, "wb") as f:
            pickle.dump({"times": times, "raw_frames": raw_frames,
                         "directs": directs, "steps": steps}, f)
    else:
        from rtmlib import Body
        body = Body(mode="balanced", backend="onnxruntime", device="cpu")
        aligner = FrameAligner(ref)
        stride = max(1, round(fps / SAMPLE_FPS))
        times, raw_frames, directs, steps = [], [], [], []
        idx = 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % stride:
                idx += 1
                continue
            t = idx / fps
            if t > duration:
                break
            H_dir, n_dir, H_step = aligner.observe(frame)
            kpts, scores = body(frame)
            exposure = frame_exposure_ref(frame)
            dets = []
            for i in range(len(kpts)):
                k, s = kpts[i], scores[i]
                tv = None
                if all(s[j] > KPT_CONF for j in (L_SHO, R_SHO, L_HIP, R_HIP)):
                    tx = int(np.mean([k[j][0] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                    ty = int(np.mean([k[j][1] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                    if 0 <= tx < width and 0 <= ty < height:
                        tv = float(frame[ty, tx].mean())
                dets.append({"kpts": k, "scores": s, "torso_val": tv,
                             "app": torso_appearance(frame, k, s, exposure)})
            times.append(t)
            raw_frames.append(dets)
            directs.append((H_dir, n_dir))
            steps.append(H_step)
            idx += 1
            if len(times) % 400 == 0:
                print(f"  ... {t:.0f}s / {duration:.0f}s")
        cap.release()
        with open(cache_path, "wb") as f:
            pickle.dump({"times": times, "raw_frames": raw_frames,
                         "directs": directs, "steps": steps}, f)

    # ---------------- pass 2: final alignment + court filter + tracking ----------------
    aligns, anchored_pct = build_alignments(directs, steps)
    if anchored_pct < 95:
        notes.append(f"camera alignment anchored for {anchored_pct:.0f}% of frames; "
                     "positions in unanchored stretches are less reliable")
    track_frames = []
    tracker = TwoTracker()
    torso_vals = {"A": [], "B": []}
    for i in range(len(times)):
        H_align = aligns[i]
        H_px2court = H_ref2court @ H_align
        dets = detect_players(raw_frames[i], H_px2court)
        tracked = tracker.update(dets, times[i])
        for pid, d in tracked.items():
            d["H_align"] = H_align
            if d.get("torso_val") is not None:
                torso_vals[pid].append(d["torso_val"])
        track_frames.append(tracked)

    frames_analyzed = len(times)
    both_pct = 100.0 * sum(1 for tf in track_frames if len(tf) == 2) / max(frames_analyzed, 1)
    align_pct = anchored_pct

    # player labels from torso brightness
    labels = {"A": "Player A", "B": "Player B"}
    if torso_vals["A"] and torso_vals["B"]:
        ma, mb = np.median(torso_vals["A"]), np.median(torso_vals["B"])
        if abs(ma - mb) > 25:
            labels["A" if ma < mb else "B"] += " (darker shirt)"
            labels["B" if ma < mb else "A"] += " (lighter shirt)"

    # ---------------- shot moments ----------------
    tmp = os.path.join(args.out, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    wav = extract_audio(args.video, tmp)
    audio_available = wav is not None
    if audio_available:
        onsets, (env_t, env) = audio_onsets(wav)
        onsets = [t for t in onsets if t <= duration]
    else:
        notes.append("no audio track: shot moments from wrist-speed peaks (less reliable)")
        onsets, (env_t, env) = wrist_speed_onsets(track_frames, times)

    # striker attribution, with a swing gate to reject onsets from neighbouring
    # courts, voices, and between-rally ball-bouncing (measured separation:
    # real swings peak >= ~2 bbox-heights/s, bounces/walking < ~1.9)
    WRIST_PEAK_GATE = 1.9
    ANKLE_GATE = 0.30   # meters moved over the window (fallback signal)
    n_gated = 0
    passed = []         # (t, pid, swing_peak) — survivors of the swing gate
    for t in onsets:
        lo = max(0, int(np.searchsorted(times, t - WRIST_WIN_S)))
        hi = min(len(times) - 1, int(np.searchsorted(times, t + WRIST_WIN_S)))
        if hi < lo:
            continue
        trav, obs = {}, {}
        for p in ("A", "B"):
            trav[p], obs[p] = peak_wrist_speed(track_frames, times, lo, hi, p)
        if obs["A"] >= 2 or obs["B"] >= 2:
            if audio_available and max(trav.values()) < WRIST_PEAK_GATE:
                n_gated += 1
                continue
        else:
            # wrists never seen in the window: ankle-speed fallback
            def ankle_speed(pid):
                pts = [(times[i],) + track_frames[i][pid]["court"]
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

    # Second gate: the onset has to land while a rally is actually being played
    # on this court. Measured on 72 hand-labelled moments across three matches,
    # this is what lifts precision from 41% to 71% without costing a single
    # true strike; the swing gate alone cannot do it because the false onsets
    # are real racquet strikes — from the neighbouring courts.
    act = rally_activity(track_frames, times)
    act_thr = float(np.percentile(act, RALLY_ACT_Q)) if len(act) else 0.0
    # ...unless the swing itself is unmistakable: an overhead serve struck as a
    # rally begins sits in a still-quiet window, so a top-decile swing peak
    # overrides the rally test outright.
    strong_thr = (STRONG_SWING_F * float(np.percentile([p[2] for p in passed], 90))
                  if passed else float("inf"))
    shots_raw = []      # (t, striker_pid, court_pos, track_frame_index)
    n_rally_gated = 0
    for t, pid, peak in passed:
        j = int(np.clip(np.searchsorted(times, t), 0, len(times) - 1))
        if j > 0 and abs(times[j - 1] - t) < abs(times[j] - t):
            j -= 1
        if act[j] < act_thr and peak < strong_thr:
            n_rally_gated += 1
            continue
        i = nearest_tracked(track_frames, times, t, pid)
        if i is None:
            continue
        shots_raw.append((float(t), pid, track_frames[i][pid]["court"], i))
    if n_gated:
        notes.append(f"{n_gated} audio onsets rejected by the player-activity gate "
                     "(likely neighbouring courts, voices or bounces)")
    if n_rally_gated:
        notes.append(f"{n_rally_gated} further onsets rejected as between-point noise "
                     "(no rally in progress on this court)")

    # ---------------- rallies + retrieval-proxy placement ----------------
    rallies = []
    cur = []
    for s in shots_raw:
        if cur and s[0] - cur[-1][0] > args.rally_gap:
            rallies.append(cur)
            cur = []
        cur.append(s)
    if cur:
        rallies.append(cur)
    rallies = [r for r in rallies if len(r) >= 2]

    shots_out = []
    placements = {"A": [], "B": []}  # ordered cells per striker
    for r in rallies:
        for k in range(len(r) - 1):
            t_k, pid_k, pos_k, idx_k = r[k]
            _t_n, pid_n, pos_n, idx_n = r[k + 1]  # opponent's retrieval position
            cell = cell_of(*pos_n)
            # both indices came from nearest_tracked for that player, so the
            # detection behind each end of the shot is always there
            striker_det = track_frames[idx_k][pid_k]
            land_det = track_frames[idx_n][pid_n]
            shot_type = classify_shot(k == 0, high_contact(striker_det), pos_k, pos_n)
            shots_out.append({
                "tSec": round(t_k, 2),
                "player": pid_k,
                "cell": cell,
                "type": shot_type,
                "typeConfidence": shot_confidence(shot_type, striker_det["pos_conf"],
                                                  land_det["pos_conf"]),
            })
            placements[pid_k].append(cell)

    total_strikes = sum(len(r) for r in rallies)
    if len(shots_raw) and not rallies:
        notes.append("onsets detected but no rally had >= 2 attributed shots")
    if args.rally_gap != RALLY_GAP_S:
        notes.append(f"rally split gap set to {args.rally_gap:.1f}s for this venue "
                     f"(default {RALLY_GAP_S:.1f}s; serve turnarounds here are ~5s)")
    notes.append(f"{len(onsets)} onsets detected, {len(shots_raw)} attributed to a striker, "
                 f"{total_strikes} inside rallies, {len(shots_out)} placed via retrieval proxy")

    # ---------------- per-player analytics ----------------
    players = []
    for pid in ("A", "B"):
        heat = np.zeros((HEAT_ROWS, HEAT_COLS))
        n_pos, n_t = 0, 0
        for tf in track_frames:
            if pid not in tf:
                continue
            x, y = tf[pid]["court"]
            r_i = min(int(y / COURT_L * HEAT_ROWS), HEAT_ROWS - 1)
            c_i = min(int(x / COURT_W * HEAT_COLS), HEAT_COLS - 1)
            heat[r_i, c_i] += 1
            n_pos += 1
            if math.hypot(x - T_POS[0], y - T_POS[1]) <= T_RADIUS:
                n_t += 1
        if heat.max() > 0:
            heat = heat / heat.max()
        counts = {c: placements[pid].count(c)
                  for c in ("frontLeft", "frontRight", "backLeft", "backRight")}
        players.append({
            "id": pid,
            "label": labels[pid],
            "shots": len(placements[pid]),
            "placement": counts,
            "coverageHeatmap": {"rows": HEAT_ROWS, "cols": HEAT_COLS,
                                "values": [round(float(v), 4) for v in heat.flatten()]},
            "tTimePct": round(100.0 * n_t / max(n_pos, 1), 1),
            "predictability": entropy_predictability(placements[pid]),
        })

    tracks = build_tracks(times, track_frames, width, height)

    rally_lens = [len(r) for r in rallies]
    analysis = {
        "schemaVersion": 2,
        "video": {
            "source": meta.get("source", os.path.basename(args.video)),
            "license": meta.get("license", "unknown"),
            "durationSec": round(duration, 2),
            "fps": round(fps, 3),
            "width": width,
            "height": height,
        },
        "court": {"gridRows": 2, "gridCols": 2},
        "players": players,
        "rallies": {
            "count": len(rallies),
            "avgShotsPerRally": round(float(np.mean(rally_lens)), 2) if rally_lens else 0,
            "longestRally": max(rally_lens) if rally_lens else 0,
        },
        "shots": shots_out,
        "tracks": tracks,
        "quality": {
            "framesAnalyzed": frames_analyzed,
            "bothPlayersDetectedPct": round(both_pct, 1),
            "audioAvailable": audio_available,
            "notes": notes,
        },
    }
    analysis_path = os.path.join(args.out, "analysis.json")
    dump_analysis(analysis, analysis_path)

    # ---------------- verification artifacts ----------------
    colors = {"A": (80, 220, 80), "B": (80, 120, 255)}
    cap = cv2.VideoCapture(args.video)
    both_idx = [i for i, tf in enumerate(track_frames) if len(tf) == 2]
    pick_pool = both_idx if len(both_idx) >= 8 else list(range(len(track_frames)))
    picks = [pick_pool[int(k * (len(pick_pool) - 1) / 7)] for k in range(8)] if pick_pool else []
    for n, i in enumerate(dict.fromkeys(picks)):
        frame = extract_frame(cap, times[i])
        if frame is None:
            continue
        tf = track_frames[i]
        H_align = next(iter(tf.values()))["H_align"] if tf else np.eye(3)
        H_court2frame = np.linalg.inv(H_ref2court @ H_align)
        draw_court(frame, H_court2frame)
        for pid, d in tf.items():
            draw_player(frame, d, pid, colors)
        cv2.putText(frame, f"t={times[i]:.1f}s", (8, 22), cv2.FONT_HERSHEY_SIMPLEX,
                    0.7, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.imwrite(os.path.join(args.out, f"overlay_{n:02d}_t{times[i]:.0f}s.jpg"), frame)
    cap.release()

    for p in players:
        grid = np.array(p["coverageHeatmap"]["values"]).reshape(HEAT_ROWS, HEAT_COLS)
        render_heatmap(grid, os.path.join(args.out, f"heatmap_{p['id']}.png"),
                       f"{p['label']} coverage (T time {p['tTimePct']}%)")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(12, 3.2))
    ax.plot(env_t, env, lw=0.6, color="#888",
            label="onset strength" if audio_available else "wrist speed")
    for t in onsets:
        ax.axvline(t, color="tomato", lw=0.7, alpha=0.7)
    for r in rallies:
        ax.axvspan(r[0][0], r[-1][0], color="lightgreen", alpha=0.25)
    for s in shots_out:
        ax.plot(s["tSec"], 0, marker="^", color="green" if s["player"] == "A" else "royalblue",
                ms=6, clip_on=False)
    ax.set_xlim(0, duration)
    ax.set_xlabel("time (s)")
    ax.set_title(f"shot onsets ({'audio' if audio_available else 'wrist-speed fallback'}); "
                 f"green spans = rallies; markers = placed shots (A=green, B=blue)")
    fig.tight_layout()
    fig.savefig(os.path.join(args.out, "onsets.png"), dpi=110)
    plt.close(fig)

    shot_types = {}
    for s in shots_out:
        shot_types[s["type"]] = shot_types.get(s["type"], 0) + 1
    print(json.dumps({
        "framesAnalyzed": frames_analyzed,
        "bothPlayersDetectedPct": round(both_pct, 1),
        "alignPct": round(align_pct, 1),
        "audioAvailable": audio_available,
        "onsets": len(onsets),
        "rallies": len(rallies),
        "placedShots": len(shots_out),
        "shotsA": players[0]["shots"], "shotsB": players[1]["shots"],
        "tTimeA": players[0]["tTimePct"], "tTimeB": players[1]["tTimePct"],
        "shotTypes": shot_types,
        "trackSamples": len(tracks),
        "analysisBytes": os.path.getsize(analysis_path),
    }, indent=2))


if __name__ == "__main__":
    main()
