#!/usr/bin/env python3
"""Validate an analysis.json against the schemaVersion 1/2 contract + sanity checks.

v2 adds `tracks` (pose keypoints for the app's skeleton overlay) and shot
`type`/`typeConfidence`; both are optional, so v1 files still validate.
"""
import json
import sys

CELLS = ("frontLeft", "frontRight", "backLeft", "backRight")
SHOT_TYPES = ("serve", "drive", "crossCourt", "drop", "boast", "volley", "unknown")
N_KPT_VALUES = 51  # 17 COCO keypoints x [x, y, conf]


def fail(msg, errs):
    errs.append(msg)


def main(path):
    d = json.load(open(path))
    errs, warns = [], []

    if d.get("schemaVersion") not in (1, 2):
        fail(f"schemaVersion {d.get('schemaVersion')} not in (1, 2)", errs)
    v = d.get("video", {})
    for k, t in [("source", str), ("license", str), ("durationSec", (int, float)),
                 ("fps", (int, float)), ("width", int), ("height", int)]:
        if not isinstance(v.get(k), t):
            fail(f"video.{k} missing/wrong type", errs)
    if d.get("court") != {"gridRows": 2, "gridCols": 2}:
        fail("court != 2x2", errs)

    players = d.get("players", [])
    if [p.get("id") for p in players] != ["A", "B"]:
        fail("players must be [A, B]", errs)
    for p in players:
        pid = p.get("id")
        if not isinstance(p.get("label"), str):
            fail(f"{pid}.label", errs)
        pl = p.get("placement", {})
        if set(pl.keys()) != set(CELLS):
            fail(f"{pid}.placement keys", errs)
        if sum(pl.values()) != p.get("shots"):
            fail(f"{pid}: placement sum {sum(pl.values())} != shots {p.get('shots')}", errs)
        hm = p.get("coverageHeatmap", {})
        if hm.get("rows") != 12 or hm.get("cols") != 8:
            fail(f"{pid}.heatmap dims", errs)
        vals = hm.get("values", [])
        if len(vals) != 96:
            fail(f"{pid}.heatmap len {len(vals)} != 96", errs)
        elif vals and (min(vals) < 0 or max(vals) > 1.0001):
            fail(f"{pid}.heatmap values out of [0,1]", errs)
        elif max(vals, default=0) == 0:
            warns.append(f"{pid}: heatmap all zeros (never tracked?)")
        if not (0 <= p.get("tTimePct", -1) <= 100):
            fail(f"{pid}.tTimePct", errs)
        pr = p.get("predictability", {})
        for k in ("score", "entropyBits", "maxEntropyBits", "topPattern"):
            if k not in pr:
                fail(f"{pid}.predictability.{k}", errs)
        if not (0 <= pr.get("score", -1) <= 1):
            fail(f"{pid}.predictability.score out of [0,1]", errs)

    r = d.get("rallies", {})
    for k in ("count", "avgShotsPerRally", "longestRally"):
        if k not in r:
            fail(f"rallies.{k}", errs)

    shots = d.get("shots", [])
    for i, s in enumerate(shots):
        if s.get("player") not in ("A", "B") or s.get("cell") not in CELLS \
                or not isinstance(s.get("tSec"), (int, float)):
            fail(f"shots[{i}] malformed", errs)
    for pid in ("A", "B"):
        n_shots = sum(1 for s in shots if s["player"] == pid)
        p = next(p for p in players if p["id"] == pid)
        if n_shots != p["shots"]:
            fail(f"{pid}: shots[] count {n_shots} != players.shots {p['shots']}", errs)
    if [s["tSec"] for s in shots] != sorted(s["tSec"] for s in shots):
        fail("shots not time-ordered", errs)
    for i, s in enumerate(shots):
        if "type" not in s:
            continue  # optional in v2, absent in v1
        if s["type"] not in SHOT_TYPES:
            fail(f"shots[{i}].type {s['type']!r} not in {SHOT_TYPES}", errs)
        tc = s.get("typeConfidence")
        if not isinstance(tc, (int, float)) or not (0 <= tc <= 1):
            fail(f"shots[{i}].typeConfidence {tc!r} not in [0,1]", errs)
        elif s["type"] == "unknown" and tc != 0:
            fail(f"shots[{i}]: unknown type must carry confidence 0, got {tc}", errs)

    tracks = d.get("tracks")
    if tracks is not None:
        if not isinstance(tracks, list):
            fail("tracks must be a list", errs)
            tracks = []
        prev_t = None
        for i, sample in enumerate(tracks):
            t = sample.get("t")
            if not isinstance(t, (int, float)) or not (0 <= t <= v.get("durationSec", 0) + 1):
                fail(f"tracks[{i}].t {t!r} outside the video", errs)
            elif prev_t is not None and t <= prev_t:
                fail(f"tracks[{i}].t {t} does not ascend past {prev_t}", errs)
            else:
                prev_t = t
            for p in sample.get("p", []):
                if p.get("id") not in ("A", "B"):
                    fail(f"tracks[{i}] player id {p.get('id')!r}", errs)
                k = p.get("k", [])
                if len(k) != N_KPT_VALUES:
                    fail(f"tracks[{i}] {p.get('id')}.k len {len(k)} != {N_KPT_VALUES}", errs)
                elif min(k) < 0 or max(k) > 1:
                    fail(f"tracks[{i}] {p.get('id')}.k outside [0,1]", errs)
        if not tracks:
            warns.append("tracks present but empty (no skeleton overlay in the app)")

    q = d.get("quality", {})
    for k, t in [("framesAnalyzed", int), ("bothPlayersDetectedPct", (int, float)),
                 ("audioAvailable", bool), ("notes", list)]:
        if not isinstance(q.get(k), t):
            fail(f"quality.{k}", errs)
    if q.get("audioAvailable") and not shots:
        warns.append("audio available but zero placed shots")

    print(f"{path}: {'PASS' if not errs else 'FAIL'}")
    for e in errs:
        print("  ERROR:", e)
    for w in warns:
        print("  warn:", w)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(max(main(p) for p in sys.argv[1:]))
