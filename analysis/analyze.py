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
  6. Analytics per player + verification artifacts + analysis.json (schemaVersion 1).

Court frame: x in [0, 6.4] (0 = left wall), y in [0, 9.75] (0 = front wall).
"""
import argparse
import json
import math
import os
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
WRIST_WIN_S = 0.25
MIN_ALIGN_INLIERS = 25
KPT_CONF = 0.3
COURT_MARGIN = 0.8  # meters of slack when filtering detections to the court

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
class Aligner:
    """ORB alignment of each frame to the calibration reference frame."""

    def __init__(self, ref_img):
        self.orb = cv2.ORB_create(2500)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        g = cv2.cvtColor(ref_img, cv2.COLOR_BGR2GRAY)
        self.ref_kp, self.ref_desc = self.orb.detectAndCompute(g, None)
        self.last_good = np.eye(3)
        self.n_aligned = 0
        self.n_total = 0

    def align(self, frame):
        """Return H mapping frame pixels -> reference pixels (fallback: last good)."""
        self.n_total += 1
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        kp, desc = self.orb.detectAndCompute(g, None)
        if desc is None or len(kp) < 30:
            return self.last_good, False
        matches = self.matcher.match(desc, self.ref_desc)
        if len(matches) < 30:
            return self.last_good, False
        matches = sorted(matches, key=lambda m: m.distance)[:500]
        src = np.float32([kp[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst = np.float32([self.ref_kp[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
        if H is None or mask.sum() < MIN_ALIGN_INLIERS:
            return self.last_good, False
        # sanity: reject wild warps (scale way off / flips)
        det = np.linalg.det(H[:2, :2])
        if not (0.25 < det < 4.0):
            return self.last_good, False
        self.last_good = H
        self.n_aligned += 1
        return H, True


# ---------------------------------------------------------------- pose + tracking
def detect_players(kpts, scores, H_px2court):
    """Filter rtmlib detections to in-court players; keep the 2 biggest."""
    cands = []
    for i in range(len(kpts)):
        k, s = kpts[i], scores[i]
        ank = []
        for j in (L_ANK, R_ANK):
            if s[j] > KPT_CONF:
                ank.append(k[j])
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
            "court": (float(np.clip(cx, 0, COURT_W)), float(np.clip(cy, 0, COURT_L))),
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
    import librosa
    y, sr = librosa.load(wav, sr=22050, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=sr)
    times = librosa.onset.onset_detect(onset_envelope=env, sr=sr, units="time",
                                       backtrack=False, delta=np.percentile(env, 90) * 0.30,
                                       wait=2)
    merged = []
    for t in times:
        if merged and t - merged[-1] < ONSET_MERGE_S:
            continue
        merged.append(float(t))
    env_t = librosa.times_like(env, sr=sr)
    return merged, (env_t, env)


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
def wrist_travel(track_frames, times, idx_lo, idx_hi, pid):
    total = {L_WRI: 0.0, R_WRI: 0.0}
    prev = {}
    for i in range(idx_lo, idx_hi + 1):
        d = track_frames[i].get(pid)
        if d is None:
            continue
        for j in (L_WRI, R_WRI):
            if d["scores"][j] > KPT_CONF:
                cur = d["kpts"][j]
                if j in prev:
                    total[j] += float(np.hypot(*(cur - prev[j]))) / max(d["bbox_h"], 1.0)
                prev[j] = cur
    return max(total.values())


def nearest_tracked(track_frames, times, t, pid, max_dt=0.6):
    best_i, best_dt = None, max_dt
    for i, ti in enumerate(times):
        dt = abs(ti - t)
        if dt < best_dt and pid in track_frames[i]:
            best_i, best_dt = i, dt
    return best_i


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
    aligner = Aligner(ref)

    from rtmlib import Body
    body = Body(mode="balanced", backend="onnxruntime", device="cpu")

    # ---------------- pass over sampled frames ----------------
    stride = max(1, round(fps / SAMPLE_FPS))
    times, track_frames = [], []
    tracker = TwoTracker()
    torso_vals = {"A": [], "B": []}
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
        H_align, _ = aligner.align(frame)
        H_px2court = H_ref2court @ H_align
        kpts, scores = body(frame)
        dets = detect_players(kpts, scores, H_px2court)
        tracked = tracker.update(dets)
        for pid, d in tracked.items():
            d["H_align"] = H_align
            k, s = d["kpts"], d["scores"]
            if all(s[j] > KPT_CONF for j in (L_SHO, R_SHO, L_HIP, R_HIP)):
                tx = int(np.mean([k[j][0] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                ty = int(np.mean([k[j][1] for j in (L_SHO, R_SHO, L_HIP, R_HIP)]))
                if 0 <= tx < width and 0 <= ty < height:
                    torso_vals[pid].append(frame[ty, tx].mean())
        times.append(t)
        track_frames.append(tracked)
        idx += 1
        if len(times) % 400 == 0:
            print(f"  ... {t:.0f}s / {duration:.0f}s")
    cap.release()

    frames_analyzed = len(times)
    both_pct = 100.0 * sum(1 for tf in track_frames if len(tf) == 2) / max(frames_analyzed, 1)
    align_pct = 100.0 * aligner.n_aligned / max(aligner.n_total, 1)
    if align_pct < 90:
        notes.append(f"camera alignment succeeded on {align_pct:.0f}% of frames; "
                     "unaligned frames reuse the previous homography")

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

    # striker attribution
    shots_raw = []  # (t, striker_pid, court_pos)
    for t in onsets:
        lo = max(0, int(np.searchsorted(times, t - WRIST_WIN_S)))
        hi = min(len(times) - 1, int(np.searchsorted(times, t + WRIST_WIN_S)))
        if hi < lo:
            continue
        trav = {p: wrist_travel(track_frames, times, lo, hi, p) for p in ("A", "B")}
        if trav["A"] <= 0 and trav["B"] <= 0:
            # fallback: fastest-moving player by ankle speed
            def ankle_speed(pid):
                pts = [(times[i],) + track_frames[i][pid]["court"]
                       for i in range(lo, hi + 1) if pid in track_frames[i]]
                if len(pts) < 2:
                    return 0.0
                return sum(math.hypot(b[1] - a[1], b[2] - a[2]) for a, b in zip(pts, pts[1:]))
            trav = {p: ankle_speed(p) for p in ("A", "B")}
            if trav["A"] <= 0 and trav["B"] <= 0:
                continue
        pid = "A" if trav["A"] >= trav["B"] else "B"
        i = nearest_tracked(track_frames, times, t, pid)
        if i is None:
            continue
        shots_raw.append((float(t), pid, track_frames[i][pid]["court"]))

    # ---------------- rallies + retrieval-proxy placement ----------------
    rallies = []
    cur = []
    for s in shots_raw:
        if cur and s[0] - cur[-1][0] > RALLY_GAP_S:
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
            t_k, pid_k, _pos_k = r[k]
            _t_n, _pid_n, pos_n = r[k + 1]  # opponent's retrieval position
            cell = cell_of(*pos_n)
            shots_out.append({"tSec": round(t_k, 2), "player": pid_k, "cell": cell})
            placements[pid_k].append(cell)

    total_strikes = sum(len(r) for r in rallies)
    if len(shots_raw) and not rallies:
        notes.append("onsets detected but no rally had >= 2 attributed shots")
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

    rally_lens = [len(r) for r in rallies]
    analysis = {
        "schemaVersion": 1,
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
        "quality": {
            "framesAnalyzed": frames_analyzed,
            "bothPlayersDetectedPct": round(both_pct, 1),
            "audioAvailable": audio_available,
            "notes": notes,
        },
    }
    with open(os.path.join(args.out, "analysis.json"), "w") as f:
        json.dump(analysis, f, indent=2)

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
    }, indent=2))


if __name__ == "__main__":
    main()
