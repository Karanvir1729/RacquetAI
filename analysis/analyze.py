#!/usr/bin/env python3
"""RacquetAI v0 squash shot-placement analysis pipeline.

Usage:
    analyze.py --video samples/clip.mp4 --corners samples/clip.corners.json --out out/clip

Stages:
  1. Decode + sample ~8 fps.
  2. Per-frame ORB alignment to a reference frame (handles handheld camera drift),
     composed with a hand-calibrated floor homography (pixels -> court meters).
  3. RTMPose (rtmlib, CPU) 2-person pose; nearest-neighbor 2-ID tracking with swap guard.
  4. Shot moments from audio onsets (librosa spectral flux); wrist-speed peaks if no audio.
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
RALLY_GAP_S = 8.0
WRIST_WIN_S = 0.30
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
            "court": (float(np.clip(cx, 0, COURT_W)), float(np.clip(cy, 0, COURT_L))),
            # the court fix is only as good as the ankles it was projected from
            "pos_conf": float(np.mean(ank_conf)),
            "area": float(w * h), "bbox_h": float(h),
        })
    cands.sort(key=lambda c: -c["area"])
    return cands[:2]


class TwoTracker:
    """Nearest-neighbor 2-ID association on court positions with a swap guard."""

    def __init__(self):
        self.pos = {"A": None, "B": None}

    def update(self, dets):
        out = {}
        if len(dets) == 0:
            return out
        if self.pos["A"] is None and self.pos["B"] is None:
            # first sight: leftmost player becomes A
            dets = sorted(dets, key=lambda d: d["court"][0])
            out["A"] = dets[0]
            if len(dets) > 1:
                out["B"] = dets[1]
        elif len(dets) == 1:
            d = dets[0]
            da = self._dist("A", d)
            db = self._dist("B", d)
            out["A" if da <= db else "B"] = d
        else:
            d0, d1 = dets[0], dets[1]
            keep = self._dist("A", d0) + self._dist("B", d1)
            swap = self._dist("A", d1) + self._dist("B", d0)
            # swap guard: prefer current identities unless swapping is clearly better
            if swap < keep * 0.7:
                out["A"], out["B"] = d1, d0
            else:
                out["A"], out["B"] = d0, d1
        for pid, d in out.items():
            self.pos[pid] = d["court"]
        return out

    def _dist(self, pid, det):
        if self.pos[pid] is None:
            return 3.0  # neutral prior
        p = self.pos[pid]
        q = det["court"]
        return math.hypot(p[0] - q[0], p[1] - q[1])


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
    thr = med + 1.0 * (p95 - med)
    peaks, _ = find_peaks(env, height=thr, prominence=0.5 * (p95 - med),
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
    cache_path = os.path.join(args.out, "pose_cache_v2.pkl")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            blob = pickle.load(f)
        times, raw_frames = blob["times"], blob["raw_frames"]
        directs, steps = blob["directs"], blob["steps"]
        print(f"pose cache hit: {len(times)} frames")
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
            dets = []
            for i in range(len(kpts)):
                k, s = kpts[i], scores[i]
                tv = None
                if all(s[j] > KPT_CONF for j in (L_SHO, R_SHO, L_HIP, R_HIP)):
                    tx = int(np.mean([k[j][0] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                    ty = int(np.mean([k[j][1] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                    if 0 <= tx < width and 0 <= ty < height:
                        tv = float(frame[ty, tx].mean())
                dets.append({"kpts": k, "scores": s, "torso_val": tv})
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
        tracked = tracker.update(dets)
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
    shots_raw = []      # (t, striker_pid, court_pos, track_frame_index)
    n_gated = 0
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
        i = nearest_tracked(track_frames, times, t, pid)
        if i is None:
            continue
        shots_raw.append((float(t), pid, track_frames[i][pid]["court"], i))
    if n_gated:
        notes.append(f"{n_gated} audio onsets rejected by the player-activity gate "
                     "(likely neighbouring courts, voices or bounces)")

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
