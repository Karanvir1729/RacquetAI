#!/usr/bin/env python3
"""Render one montage per candidate rally boundary, for hand-labelling outcomes.

The question being labelled is "who won this rally, and why". Without ball
tracking the ball is ~2 px at this source resolution (854x480), so the label
cannot come from watching the ball. It comes from player behaviour, and the
single most reliable cue in PAR scoring is THE NEXT SERVE: the player who wins
a rally serves the next one. So every montage deliberately spans three things:

    the last strike  ->  the aftermath  ->  the next serve

A candidate boundary is a gap of >= --min-gap seconds between two consecutive
attributed shots (from eval/candidates_<clip>.json, i.e. the detector's own
shot stream). That pool is a superset of the true rally ends: a real squash
point is followed by several seconds of walking back, so a true rally end
essentially never has a sub-2 s gap. Labelling the whole pool therefore yields
both the rally-end precision AND, on the real ends, the accuracy of the
"last striker won" heuristic.

Tile layout (4 cols x 3 rows), tA = last shot before the gap, tB = next shot:

    row 1  tA-1.80  tA-1.20        tA-0.70  tA-0.30   the strikes leading in
    row 2  tA-0.05(YELLOW)  tA+0.35  tA+1.00  tA+2.00  last contact + aftermath
    row 3  tB-1.00  tB+0.30(CYAN)  tB+1.10  tB+1.90   walk back + the serve

Engine identities are drawn on every tile so a label can also be read in the
engine's own ID space: GREEN = player A, MAGENTA = player B. The yellow tile is
the detector's last shot of the rally; the cyan tile is its next shot.

The winner is read off the SERVE, not off the ball: under both PAR and English
scoring the player who wins a rally serves the next one, so "who serves next"
is the winner. The serve is identified by configuration rather than by seeing
contact -- server upright in a service box holding the ball, receiver crouched
in the opposite back quarter -- which is legible at this resolution when the
strike itself is not.

    .venv/bin/python tools/rally_end_frames.py --clip archive_match2 \
        --outdir /tmp/rally_ends --min-gap 2.5

This tool is read-only: it reads samples/, eval/candidates_*.json and
eval/boxes_*.json and writes only PNGs plus an index JSON. It never runs pose
inference and never touches analyze.py.
"""
import argparse
import bisect
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 854, 480
TILE_W, TILE_H = 427, 240          # 4x2 -> 1708x480
# The top of the frame is ceiling and the right edge is corridor behind the
# glass; cropping them buys real pixels on the players at the same tile size.
CROP = (0, 24, 800, 456)
COLORS = {"A": "0x00ff00", "B": "0xff00ff"}
# Offsets and tile borders. tA = last detected shot before the gap, tB = first
# detected shot after it.
#
# Row 1 is the pre-roll and it is the whole reason this view works. tA is only
# the detector's last shot, and the detector fires on ball pickups: at
# archive_match2 t=8.68 the "shot" is a player bending down to collect a dead
# ball, so the true last contact is earlier and a two-row view would have
# mislabelled the striker. Row 1 shows the strikes leading in.
#
# Row 3 runs PAST tB because tB is not reliably the serve either -- at
# archive_match2 t=252.10 it fired on the server bouncing the ball and the
# serve itself came 1.2 s later.
PRE = ((-1.80, "white"), (-1.20, "white"), (-0.70, "white"), (-0.30, "white"),
       (-0.05, "yellow"), (0.35, "white"), (1.00, "white"), (2.00, "white"))
POST = ((-1.00, "white"), (0.30, "cyan"), (1.10, "white"), (1.90, "white"))


def boxes_at(plan, t):
    """Tracked A/B pixel boxes at the pose-cache sample nearest t."""
    times = plan["times"]
    i = bisect.bisect_left(times, t)
    cands = [j for j in (i - 1, i) if 0 <= j < len(times)]
    if not cands:
        return {}
    return plan["players"][min(cands, key=lambda j: abs(times[j] - t))]


def boxes_vf(plan, tt):
    """drawbox filters for A/B, in tile coords after the crop and scale."""
    cx, cy, cw, ch = CROP
    sx, sy = TILE_W / cw, TILE_H / ch
    out = ""
    for pid, b in boxes_at(plan, tt).items():
        out += (f",drawbox=x={(b[0] - cx) * sx:.0f}:y={(b[1] - cy) * sy:.0f}:"
                f"w={(b[2] - b[0]) * sx:.0f}:h={(b[3] - b[1]) * sy:.0f}:"
                f"color={COLORS[pid]}:t=2")
    return out


def tile(video, tt, border, plan, path):
    # crop only the ceiling and the corridor outside the glass -- never crop
    # toward one player, since the serve happens in a back corner and the last
    # strike often at the front, and a tight crop would hide one of them
    vf = (f"crop={CROP[2]}:{CROP[3]}:{CROP[0]}:{CROP[1]},"
          f"scale={TILE_W}:{TILE_H}:flags=lanczos") + boxes_vf(plan, tt)
    vf += f",drawbox=x=0:y=0:w=iw:h=ih:color={border}:t=4"
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(tt, 0):.3f}", "-i", video,
                    "-frames:v", "1", "-vf", vf, "-y", path], check=True)


def stack(tiles, cols, rows, out_png):
    inputs = []
    for p in tiles:
        inputs += ["-i", p]
    fc = ""
    for r in range(rows):
        fc += "".join(f"[{r * cols + c}]" for c in range(cols)) + f"hstack=inputs={cols}[r{r}];"
    fc += "".join(f"[r{r}]" for r in range(rows)) + f"vstack=inputs={rows}"
    subprocess.run(["ffmpeg", "-v", "error", *inputs, "-filter_complex", fc,
                    "-y", out_png], check=True)
    for p in tiles:
        os.remove(p)
    os.rmdir(os.path.dirname(tiles[0]))


def montage(video, plan, tA, tB, out_png):
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    paths = []
    for k, (off, border) in enumerate(PRE + POST):
        p = os.path.join(tmp, f"{k}.png")
        tile(video, (tA if k < len(PRE) else tB) + off, border, plan, p)
        paths.append(p)
    stack(paths, 4, 3, out_png)


def span(video, plan, tA, tB, out_png, cols=4, rows=4):
    """16 tiles spanning the whole break, tA-1.0 to tB+2.5.

    Anchoring on a computed rally-end instant was tried and abandoned. The last
    audio onset does not mark it -- the onset stream never goes quiet between
    points, every break here holds ungated onsets roughly one per second. Nor
    does a speed threshold: the ankle projection jitters enough that raw
    frame-to-frame speed is noise, and once smoothed, jogging back to the
    service box is indistinguishable from rally movement. So instead of
    guessing where to look, this view covers the entire break and lets the
    labeller see the last strikes, the walk back and the serve in one image.
    """
    # Start well before tA. The detector's last shot is often NOT the rally
    # end: at archive_match2 t=152.97 both players are already standing still
    # a second before it, so the point had finished earlier and the "shot" was
    # a false positive during the break. A 1 s pre-roll missed the actual end
    # in about half the breaks; 4 s catches most of them.
    n = cols * rows
    t0, t1 = tA - 4.0, tB + 2.5
    step = (t1 - t0) / (n - 1)
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    paths = []
    for k in range(n):
        p = os.path.join(tmp, f"{k}.png")
        tile(video, t0 + k * step, "white", plan, p)
        paths.append(p)
    stack(paths, cols, rows, out_png)
    return step


def filmstrip(video, plan, t0, step, n, out_png, cols=4):
    """Uniform-step strip over [t0, t0+n*step); used to learn a clip's rhythm
    and to check a stretch for rally ends the shot-gap pool would have missed."""
    rows = (n + cols - 1) // cols
    tmp = out_png + ".parts"
    os.makedirs(tmp, exist_ok=True)
    paths = []
    for k in range(rows * cols):
        p = os.path.join(tmp, f"{k}.png")
        tile(video, t0 + min(k, n - 1) * step, "white", plan, p)
        paths.append(p)
    stack(paths, cols, rows, out_png)


def boundaries(shots, min_gap, min_rally=3):
    """One record per BREAK between rallies.

    Naively taking every gap >= min_gap double-counts: the detector fires
    inside breaks, and a single spurious shot splits one break in two. At
    archive_match2 the break running ~237 s to ~252 s contains exactly one
    detected shot, at 241.07, and it produced two "boundaries" (b174 and b175)
    for what is plainly one gap between rallies -- watching it shows both
    players idling the whole way through. So segments carrying fewer than
    min_rally shots are treated as noise inside a break and dissolved, and the
    gaps either side of them merge.

    tA is the last shot of the rally that just ended, tB the first shot of the
    next one; both are the detector's, and neither is trustworthy as the true
    last contact or the serve -- that is what the frames are for.
    """
    segs, cur = [], []
    for s in shots:
        if cur and s["t"] - cur[-1]["t"] >= min_gap:
            segs.append(cur)
            cur = []
        cur.append(s)
    if cur:
        segs.append(cur)
    segs = [s for s in segs if len(s) >= min_rally]

    out = []
    for i, (a, b) in enumerate(zip(segs, segs[1:])):
        out.append({"i": i, "tA": a[-1]["t"], "engineLastStriker": a[-1]["player"],
                    "tB": b[0]["t"], "engineNextStriker": b[0]["player"],
                    "rallyShots": len(a), "rallyStart": a[0]["t"],
                    "gapSec": round(b[0]["t"] - a[-1]["t"], 2)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--min-gap", type=float, default=2.5)
    ap.add_argument("--only", default="", help="comma separated boundary indices")
    ap.add_argument("--strip", default="", help="filmstrip instead: t0,step,n")
    ap.add_argument("--candidates", default="",
                    help="candidates JSON to segment; defaults to eval/candidates_<clip>.json. "
                         "Point at eval/frozen/ to keep a label set pinned to one detector "
                         "snapshot -- the live files get regenerated as the detector changes, "
                         "which silently moves the break list out from under the labels")
    ap.add_argument("--breaks", default="",
                    help="pinned break list from make_breaks.py; overrides segmentation")
    ap.add_argument("--span", action="store_true",
                    help="16 tiles across the whole break instead of the 3-row view")
    ap.add_argument("--anchors", default="",
                    help="serve_context JSON; anchor rows 1-2 on tStop (the last "
                         "rally-pace movement) instead of the last detected shot")
    args = ap.parse_args()

    video = os.path.join(ROOT, "samples", f"{args.clip}.mp4")
    if args.breaks:
        cand = {"durationSec": 0.0, "shotsRaw": []}
    else:
        cand = json.load(open(args.candidates or
                              os.path.join(ROOT, "eval", f"candidates_{args.clip}.json")))
    plan = json.load(open(os.path.join(ROOT, "eval", f"boxes_{args.clip}.json")))
    os.makedirs(args.outdir, exist_ok=True)

    if args.strip:
        t0, step, n = args.strip.split(",")
        png = os.path.join(args.outdir, f"{args.clip}_strip_t{float(t0):07.2f}.png")
        filmstrip(video, plan, float(t0), float(step), int(n), png)
        print(png)
        return

    if args.breaks:
        bs = json.load(open(args.breaks))["clips"][args.clip]
    else:
        bs = boundaries(cand["shotsRaw"], args.min_gap)
    if args.only:
        want = {int(x) for x in args.only.split(",")}
        bs = [b for b in bs if b["i"] in want]

    stops = {}
    if args.anchors:
        stops = {x["i"]: x["tStop"] for x in json.load(open(args.anchors))["boundaries"]}

    index = []
    for b in bs:
        anchor = stops.get(b["i"], b["tA"])
        png = os.path.join(args.outdir, f"{args.clip}_b{b['i']:03d}_t{b['tA']:07.2f}.png")
        if args.span:
            step = span(video, plan, anchor, b["tB"], png)
            index.append({**b, "anchor": anchor, "stepSec": round(step, 3), "png": png})
            print(png, f"gap={b['gapSec']}s step={step:.2f}s")
            continue
        montage(video, plan, anchor, b["tB"], png)
        index.append({**b, "anchor": anchor, "png": png})
        print(png, f"gap={b['gapSec']}s engineLast={b['engineLastStriker']} anchor={anchor}")

    idx_path = os.path.join(args.outdir, f"index_{args.clip}.json")
    with open(idx_path, "w") as f:
        json.dump({"clip": args.clip, "minGap": args.min_gap,
                   "durationSec": cand["durationSec"], "boundaries": index}, f, indent=1)
    print(f"{len(index)} boundaries -> {idx_path}")


if __name__ == "__main__":
    main()
