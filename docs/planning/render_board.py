#!/usr/bin/env python3
"""
excalidraw_board.py -- dependency-free (stdlib only) renderer that turns a
content JSON file into a valid .excalidraw scene file: one tall board holding

  0. board title / subtitle
  A. a 7-day plan drawn as a swimlane grid (track rows x day columns)
     + milestone marker band + three notes panels
  B. a squash-club section: one column per pillar, feature cards with P0/P1/P2
     badges, a wrapping requirements band, and an open-questions panel

Everything is laid out by a real measurement pass: every box height is derived
from its own wrapped text before the next element is positioned, so nothing
overlaps.

usage:
    python3 excalidraw_board.py <content.json> <out.excalidraw> [--self-check]
    python3 excalidraw_board.py --self-check <existing.excalidraw>

--self-check re-reads the emitted JSON and asserts structural + geometric
invariants, then prints the board's bounding box.
"""

from __future__ import annotations

import json
import random
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------

# name -> (strokeColor, backgroundColor), from Excalidraw's own palette family
PALETTE: Dict[str, Tuple[str, str]] = {
    "green":  ("#2f9e44", "#b2f2bb"),
    "blue":   ("#1971c2", "#a5d8ff"),
    "orange": ("#e8590c", "#ffd8a8"),
    "violet": ("#6741d9", "#d0bfff"),
    "red":    ("#e03131", "#ffc9c9"),
    "teal":   ("#0c8599", "#99e9f2"),
}
COLOR_CYCLE = ["blue", "green", "violet", "orange", "teal", "red"]

INK = "#1e1e1e"          # primary text / strong strokes
MUTED = "#495057"        # secondary text
FAINT = "#ced4da"        # separators
PANEL_BG = "#f8f9fa"     # neutral panel fill
WHITE = "#ffffff"
TRANSPARENT = "transparent"
MILESTONE_STROKE = "#f08c00"
MILESTONE_BG = "#ffec99"
P2_STROKE = "#868e96"
P2_BG = "#f1f3f5"

def pal(name: Optional[str], fallback: str = "blue") -> Tuple[str, str]:
    """Map a content colour name onto an Excalidraw (stroke, background) pair."""
    if not name:
        return PALETTE[fallback]
    return PALETTE.get(str(name).strip().lower(), PALETTE[fallback])


# --------------------------------------------------------------------------
# type / font metrics
# --------------------------------------------------------------------------

LINE_HEIGHT = 1.25

# average glyph width as a fraction of fontSize, per Excalidraw fontFamily.
# 1 = Excalifont (hand-drawn), 2 = Nunito (normal), 3 = Comic Shanns (code).
# Deliberately a slight over-estimate so real rendering is never wider than the
# space we reserved for it.
CHAR_W = {1: 0.55, 2: 0.52, 3: 0.60}

FS_BOARD_TITLE = 36
FS_BOARD_SUB = 18
FS_SECTION_TITLE = 24
FS_SECTION_SUB = 14
FS_HEADER = 18
FS_CARD_TITLE = 14
FS_BODY = 12
FS_BADGE = 10


def char_w(fs: int, ff: int = 1) -> float:
    return fs * CHAR_W.get(ff, 0.55)


def line_px(fs: int) -> float:
    return round(fs * LINE_HEIGHT, 2)


def est_w(s: str, fs: int, ff: int = 1) -> float:
    return round(len(s) * char_w(fs, ff), 2)


def wrap_text(s: Any, max_w: float, fs: int, ff: int = 1) -> List[str]:
    """Greedy word wrap against an average-char-width estimate of `max_w`."""
    if s is None:
        return []
    s = str(s)
    if not s.strip():
        return []
    max_chars = max(4, int(max_w / char_w(fs, ff)))
    out: List[str] = []
    for para in s.split("\n"):
        words = para.split()
        if not words:
            out.append("")
            continue
        cur = ""
        for word in words:
            # hard-break words that cannot fit on a line at all
            while len(word) > max_chars:
                if cur:
                    out.append(cur)
                    cur = ""
                out.append(word[: max_chars - 1] + "-")
                word = word[max_chars - 1:]
            cand = word if not cur else cur + " " + word
            if len(cand) <= max_chars:
                cur = cand
            else:
                out.append(cur)
                cur = word
        if cur:
            out.append(cur)
    return out


def block_size(lines: Sequence[str], fs: int, ff: int = 1) -> Tuple[float, float]:
    """(width, height) of an already-wrapped block of lines."""
    if not lines:
        return (0.0, 0.0)
    w = max((est_w(ln, fs, ff) for ln in lines), default=0.0)
    return (round(max(w, char_w(fs, ff)), 2), round(len(lines) * line_px(fs), 2))


def bullet_lines(items: Sequence[Any], max_w: float, fs: int, ff: int = 1,
                 marker: str = "• ") -> List[str]:
    """Wrap each item and prefix a bullet, indenting continuation lines."""
    indent = " " * len(marker)
    out: List[str] = []
    inner = max_w - est_w(marker, fs, ff)
    for it in items or []:
        wrapped = wrap_text(it, inner, fs, ff)
        if not wrapped:
            continue
        out.append(marker + wrapped[0])
        for cont in wrapped[1:]:
            out.append(indent + cont)
    return out


# --------------------------------------------------------------------------
# element factory
# --------------------------------------------------------------------------

SEED_RNG = random.Random(20260815)  # fixed seed -> deterministic, re-runnable
FIXED_UPDATED = 1755300000000

REQUIRED_BASE_KEYS = [
    "id", "type", "x", "y", "width", "height", "angle", "strokeColor",
    "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness",
    "opacity", "groupIds", "frameId", "roundness", "seed", "version",
    "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked",
]
REQUIRED_TEXT_KEYS = [
    "text", "fontSize", "fontFamily", "textAlign", "verticalAlign",
    "containerId", "originalText", "lineHeight", "autoResize",
]
REQUIRED_LINEAR_KEYS = [
    "points", "lastCommittedPoint", "startBinding", "endBinding",
    "startArrowhead", "endArrowhead",
]


class Scene:
    """Accumulates elements and hands out unique, stable ids."""

    def __init__(self) -> None:
        self.elements: List[Dict[str, Any]] = []
        self._n = 0

    def uid(self, prefix: str) -> str:
        self._n += 1
        return "%s-%04d" % (prefix, self._n)

    def _base(self, kind: str, prefix: str, x: float, y: float,
              w: float, h: float, stroke: str, bg: str, *,
              fill_style: str = "solid", stroke_width: float = 1,
              stroke_style: str = "solid", roughness: int = 1,
              opacity: int = 100, roundness: Optional[Dict[str, int]] = None,
              group: Optional[str] = None) -> Dict[str, Any]:
        return {
            "id": self.uid(prefix),
            "type": kind,
            "x": round(float(x), 2),
            "y": round(float(y), 2),
            "width": round(float(w), 2),
            "height": round(float(h), 2),
            "angle": 0,
            "strokeColor": stroke,
            "backgroundColor": bg,
            "fillStyle": fill_style,
            "strokeWidth": stroke_width,
            "strokeStyle": stroke_style,
            "roughness": roughness,
            "opacity": opacity,
            "groupIds": [group] if group else [],
            "frameId": None,
            "roundness": roundness,
            "seed": SEED_RNG.randint(1, 2 ** 31 - 1),
            "version": 1,
            "versionNonce": SEED_RNG.randint(1, 2 ** 31 - 1),
            "isDeleted": False,
            "boundElements": None,
            "updated": FIXED_UPDATED,
            "link": None,
            "locked": False,
        }

    def rect(self, x: float, y: float, w: float, h: float, stroke: str, bg: str,
             *, rounded: bool = True, fill_style: str = "solid",
             stroke_width: float = 1, stroke_style: str = "solid",
             roughness: int = 1, opacity: int = 100,
             group: Optional[str] = None, prefix: str = "rect") -> Dict[str, Any]:
        el = self._base("rectangle", prefix, x, y, w, h, stroke, bg,
                        fill_style=fill_style, stroke_width=stroke_width,
                        stroke_style=stroke_style, roughness=roughness,
                        opacity=opacity,
                        roundness={"type": 3} if rounded else None, group=group)
        self.elements.append(el)
        return el

    def text(self, x: float, y: float, lines: Sequence[str], fs: int, *,
             color: str = INK, ff: int = 1, align: str = "left",
             group: Optional[str] = None, opacity: int = 100,
             prefix: str = "text") -> Dict[str, Any]:
        lines = list(lines)
        if not lines:
            lines = [""]
        w, h = block_size(lines, fs, ff)
        el = self._base("text", prefix, x, y, w, h, color, TRANSPARENT,
                        fill_style="solid", stroke_width=1,
                        stroke_style="solid", roughness=1, opacity=opacity,
                        roundness=None, group=group)
        body = "\n".join(lines)
        el.update({
            "text": body,
            "fontSize": fs,
            "fontFamily": ff,
            "textAlign": align,
            "verticalAlign": "top",
            "containerId": None,
            "originalText": body,
            "lineHeight": LINE_HEIGHT,
            "autoResize": True,
        })
        self.elements.append(el)
        return el

    def hline(self, x: float, y: float, w: float, *, stroke: str = FAINT,
              stroke_width: float = 1, stroke_style: str = "solid",
              roughness: int = 0, opacity: int = 100,
              group: Optional[str] = None) -> Dict[str, Any]:
        el = self._base("line", "line", x, y, w, 0, stroke, TRANSPARENT,
                        fill_style="solid", stroke_width=stroke_width,
                        stroke_style=stroke_style, roughness=roughness,
                        opacity=opacity, roundness=None, group=group)
        el.update({
            "points": [[0, 0], [round(float(w), 2), 0]],
            "lastCommittedPoint": None,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": None,
        })
        self.elements.append(el)
        return el


# --------------------------------------------------------------------------
# layout geometry
# --------------------------------------------------------------------------

PAD = 12          # inner padding of a box
GAP = 16          # gap between sibling boxes
ROW_GAP = 18      # gap between swimlane rows
TRACK_COL_W = 210
DAY_COL_W = 285
SECTION_GAP = 56
BADGE_W = 36
BADGE_H = 20
TAG_H = 18
REQ_PER_ROW = 4
MIN_PANEL_W = 280   # a panel narrower than this wraps its text into a noodle
MIN_BOARD_W = 1180  # keeps section B readable when the plan grid is tiny


def grid_width(n_days: int) -> float:
    n_days = max(1, n_days)
    return TRACK_COL_W + GAP + n_days * DAY_COL_W + (n_days - 1) * GAP


# ---- measured sub-blocks --------------------------------------------------

def measure_card(card: Dict[str, Any], box_w: float) -> Dict[str, Any]:
    """Measure one plan card; returns wrapped content + total height."""
    inner = box_w - 2 * PAD
    title = wrap_text(card.get("title"), inner, FS_CARD_TITLE)
    detail = wrap_text(card.get("detail"), inner, FS_BODY)
    tag = card.get("tag")
    tag_txt = str(tag).strip() if tag else ""

    h = PAD
    _, th = block_size(title, FS_CARD_TITLE)
    h += th
    if detail:
        h += 6
        _, dh = block_size(detail, FS_BODY)
        h += dh
    if tag_txt:
        h += 8 + TAG_H
    h += PAD
    return {
        "title": title, "detail": detail, "tag": tag_txt,
        "height": round(h, 2), "inner": inner,
    }


def measure_feature(feat: Dict[str, Any], box_w: float) -> Dict[str, Any]:
    """Measure one squash feature card (name + badge on the top line)."""
    inner = box_w - 2 * PAD
    name_w = inner - BADGE_W - 8
    name = wrap_text(feat.get("name"), name_w, FS_CARD_TITLE)
    detail = wrap_text(feat.get("detail"), inner, FS_BODY)
    _, nh = block_size(name, FS_CARD_TITLE)
    top_h = max(nh, BADGE_H)
    h = PAD + top_h
    if detail:
        h += 6
        _, dh = block_size(detail, FS_BODY)
        h += dh
    h += PAD
    return {
        "name": name, "detail": detail, "top_h": top_h,
        "name_w": name_w, "height": round(h, 2), "inner": inner,
    }


def measure_panel(title: str, lines: Sequence[str], box_w: float,
                  title_fs: int = FS_HEADER) -> Dict[str, Any]:
    """Measure a titled panel with a pre-wrapped body block."""
    inner = box_w - 2 * PAD
    t = wrap_text(title, inner, title_fs)
    _, th = block_size(t, title_fs)
    _, bh = block_size(lines, FS_BODY)
    h = PAD + th + (8 + bh if lines else 0) + PAD
    return {"title": t, "body": list(lines), "height": round(h, 2),
            "inner": inner, "title_h": th}


# --------------------------------------------------------------------------
# renderers
# --------------------------------------------------------------------------

def draw_title_block(sc: Scene, x: float, y: float, w: float, title: Any,
                     title_fs: int, subtitle: Any, sub_fs: int, *,
                     title_color: str = INK,
                     sub_color: str = MUTED) -> float:
    t = wrap_text(title, w, title_fs)
    if t:
        sc.text(x, y, t, title_fs, color=title_color, prefix="title")
        y += block_size(t, title_fs)[1]
    s = wrap_text(subtitle, w, sub_fs)
    if s:
        y += 8
        sc.text(x, y, s, sub_fs, color=sub_color, prefix="subtitle")
        y += block_size(s, sub_fs)[1]
    return y


def draw_panel(sc: Scene, x: float, y: float, w: float, m: Dict[str, Any],
               stroke: str, bg: str, *, group: str,
               title_fs: int = FS_HEADER, title_color: Optional[str] = None,
               body_color: str = INK) -> float:
    """Draw a measured titled panel; returns its bottom y."""
    h = m["height"]
    sc.rect(x, y, w, h, stroke, bg, group=group, prefix="panel")
    ty = y + PAD
    sc.text(x + PAD, ty, m["title"], title_fs,
            color=title_color or stroke, group=group, prefix="paneltitle")
    ty += m["title_h"]
    if m["body"]:
        ty += 8
        sc.text(x + PAD, ty, m["body"], FS_BODY, color=body_color,
                group=group, prefix="panelbody")
    return y + h


def draw_badge(sc: Scene, x: float, y: float, priority: str, group: str) -> None:
    p = (priority or "P2").upper()
    if p == "P0":
        stroke, bg, sw, ss = PALETTE["red"][0], PALETTE["red"][1], 2, "solid"
        txt_color = PALETTE["red"][0]
    elif p == "P1":
        stroke, bg, sw, ss = PALETTE["orange"][0], PALETTE["orange"][1], 1, "solid"
        txt_color = PALETTE["orange"][0]
    else:
        stroke, bg, sw, ss = P2_STROKE, P2_BG, 1, "dashed"
        txt_color = P2_STROKE
    sc.rect(x, y, BADGE_W, BADGE_H, stroke, bg, stroke_width=sw,
            stroke_style=ss, group=group, prefix="badge")
    tw, th = block_size([p], FS_BADGE)
    sc.text(x + (BADGE_W - tw) / 2.0, y + (BADGE_H - th) / 2.0, [p], FS_BADGE,
            color=txt_color, group=group, prefix="badgetxt")


def draw_plan(sc: Scene, plan: Dict[str, Any], x0: float, y: float,
              total_w: float) -> float:
    """SECTION A: swimlane grid + notes panels. Returns bottom y."""
    y = draw_title_block(sc, x0, y, total_w, plan.get("title"),
                         FS_SECTION_TITLE, plan.get("subtitle"), FS_SECTION_SUB)
    y += 22

    tracks = list(plan.get("tracks") or [])
    days = list(plan.get("days") or [])
    cards = list(plan.get("cards") or [])
    if not tracks or not days:
        return y

    col_x: Dict[Any, float] = {}
    for i, d in enumerate(days):
        col_x[d.get("n")] = x0 + TRACK_COL_W + GAP + i * (DAY_COL_W + GAP)

    # ---- milestone marker band (only over days that have one) -------------
    ms = [(d, wrap_text("★ " + str(d.get("milestone")),
                        DAY_COL_W - 2 * PAD, FS_BODY))
          for d in days if d.get("milestone")]
    if ms:
        band_h = max(PAD + block_size(lines, FS_BODY)[1] + PAD
                     for _, lines in ms)
        band_h = max(band_h, 34)
        lab = wrap_text("milestones", TRACK_COL_W - 2 * PAD, FS_BODY)
        sc.text(x0 + PAD, y + (band_h - block_size(lab, FS_BODY)[1]) / 2.0,
                lab, FS_BODY, color=MUTED, prefix="mslabel")
        for d, lines in ms:
            gx = col_x.get(d.get("n"))
            if gx is None:
                continue
            g = sc.uid("g-ms")
            sc.rect(gx, y, DAY_COL_W, band_h, MILESTONE_STROKE, MILESTONE_BG,
                    stroke_width=2, group=g, prefix="msband")
            sc.text(gx + PAD, y + PAD, lines, FS_BODY, color="#a06000",
                    group=g, prefix="mstext")
        y += band_h + 10

    # ---- day header row ---------------------------------------------------
    hdr: List[Tuple[Dict[str, Any], List[str], List[str]]] = []
    for d in days:
        lbl = wrap_text(d.get("label") or ("Day %s" % d.get("n")),
                        DAY_COL_W - 2 * PAD, FS_HEADER)
        thm = wrap_text(d.get("theme"), DAY_COL_W - 2 * PAD, FS_BODY)
        hdr.append((d, lbl, thm))
    corner_l = wrap_text("Track", TRACK_COL_W - 2 * PAD, FS_HEADER)
    corner_s = wrap_text("owner / agent worktree", TRACK_COL_W - 2 * PAD, FS_BODY)

    def hdr_h(lbl: List[str], thm: List[str]) -> float:
        h = PAD + block_size(lbl, FS_HEADER)[1]
        if thm:
            h += 4 + block_size(thm, FS_BODY)[1]
        return h + PAD

    header_h = max([hdr_h(l, t) for _, l, t in hdr]
                   + [hdr_h(corner_l, corner_s)])

    gcorner = sc.uid("g-hdr")
    sc.rect(x0, y, TRACK_COL_W, header_h, MUTED, PANEL_BG, group=gcorner,
            prefix="hdrcell")
    cy = y + PAD
    sc.text(x0 + PAD, cy, corner_l, FS_HEADER, color=INK, group=gcorner,
            prefix="hdrtitle")
    cy += block_size(corner_l, FS_HEADER)[1] + 4
    sc.text(x0 + PAD, cy, corner_s, FS_BODY, color=MUTED, group=gcorner,
            prefix="hdrsub")

    for d, lbl, thm in hdr:
        gx = col_x[d.get("n")]
        g = sc.uid("g-hdr")
        sc.rect(gx, y, DAY_COL_W, header_h, MUTED, PANEL_BG, group=g,
                prefix="hdrcell")
        cy = y + PAD
        sc.text(gx + PAD, cy, lbl, FS_HEADER, color=INK, group=g,
                prefix="hdrtitle")
        cy += block_size(lbl, FS_HEADER)[1]
        if thm:
            cy += 4
            sc.text(gx + PAD, cy, thm, FS_BODY, color=MUTED, group=g,
                    prefix="hdrsub")
    y += header_h + ROW_GAP

    # ---- track rows -------------------------------------------------------
    by_cell: Dict[Tuple[Any, Any], List[Dict[str, Any]]] = {}
    for c in cards:
        by_cell.setdefault((c.get("track"), c.get("day")), []).append(c)

    for ti, tr in enumerate(tracks):
        tkey = tr.get("key")
        stroke, bg = pal(tr.get("color"))

        # measure every card in this row first
        measured: Dict[Any, List[Dict[str, Any]]] = {}
        row_content_h = 0.0
        for d in days:
            cell = by_cell.get((tkey, d.get("n")), [])
            ms_cell = [measure_card(c, DAY_COL_W) for c in cell]
            measured[d.get("n")] = ms_cell
            if ms_cell:
                cell_h = sum(m["height"] for m in ms_cell) + 10 * (len(ms_cell) - 1)
                row_content_h = max(row_content_h, cell_h)

        # measure the track label so the row can never be shorter than it
        lab_inner = TRACK_COL_W - 2 * PAD
        lab_name = wrap_text(tr.get("name"), lab_inner, FS_HEADER)
        lab_lead = wrap_text(tr.get("lead"), lab_inner, FS_BODY)
        lab_h = PAD + block_size(lab_name, FS_HEADER)[1]
        if lab_lead:
            lab_h += 6 + block_size(lab_lead, FS_BODY)[1]
        lab_h += PAD

        row_h = max(row_content_h, lab_h, 72)

        glab = sc.uid("g-track")
        sc.rect(x0, y, TRACK_COL_W, row_h, stroke, bg, stroke_width=2,
                group=glab, prefix="tracklab")
        ly = y + PAD
        sc.text(x0 + PAD, ly, lab_name, FS_HEADER, color=INK, group=glab,
                prefix="trackname")
        ly += block_size(lab_name, FS_HEADER)[1]
        if lab_lead:
            ly += 6
            sc.text(x0 + PAD, ly, lab_lead, FS_BODY, color=MUTED, group=glab,
                    prefix="tracklead")

        for d in days:
            gx = col_x[d.get("n")]
            cy = y
            for m in measured[d.get("n")]:
                g = sc.uid("g-card")
                sc.rect(gx, cy, DAY_COL_W, m["height"], stroke, bg,
                        group=g, prefix="card")
                iy = cy + PAD
                sc.text(gx + PAD, iy, m["title"], FS_CARD_TITLE, color=INK,
                        group=g, prefix="cardtitle")
                iy += block_size(m["title"], FS_CARD_TITLE)[1]
                if m["detail"]:
                    iy += 6
                    sc.text(gx + PAD, iy, m["detail"], FS_BODY, color=MUTED,
                            group=g, prefix="carddetail")
                    iy += block_size(m["detail"], FS_BODY)[1]
                if m["tag"]:
                    iy += 8
                    tw = min(est_w(m["tag"], FS_BADGE) + 16, m["inner"])
                    sc.rect(gx + PAD, iy, tw, TAG_H, stroke, WHITE,
                            stroke_width=1, group=g, prefix="tagpill")
                    ttw, tth = block_size([m["tag"]], FS_BADGE)
                    sc.text(gx + PAD + max((tw - ttw) / 2.0, 4),
                            iy + (TAG_H - tth) / 2.0, [m["tag"]], FS_BADGE,
                            color=stroke, group=g, prefix="tagtext")
                cy += m["height"] + 10

        y += row_h
        if ti < len(tracks) - 1:
            sc.hline(x0, y + ROW_GAP / 2.0, total_w, stroke=FAINT,
                     stroke_style="dashed")
            y += ROW_GAP
        else:
            y += ROW_GAP

    # ---- notes panels (three side by side) --------------------------------
    notes = plan.get("notes") or {}
    specs = [
        ("Risks & mitigations", notes.get("risks"), "red"),
        ("Out of scope this week", notes.get("outOfScope"), "violet"),
        ("Day-7 demo gate", notes.get("demoGate"), "green"),
    ]
    y += 12
    panel_w = (total_w - 2 * GAP) / 3.0
    measures = []
    for title, items, color in specs:
        lines = bullet_lines(items or [], panel_w - 2 * PAD, FS_BODY)
        measures.append((measure_panel(title, lines, panel_w), color))
    row_h = max(m["height"] for m, _ in measures)
    for i, (m, color) in enumerate(measures):
        m = dict(m)
        m["height"] = row_h  # equalise panel heights across the row
        stroke, bg = pal(color)
        draw_panel(sc, x0 + i * (panel_w + GAP), y, panel_w, m, stroke, bg,
                   group=sc.uid("g-note"))
    y += row_h
    return y


def draw_squash(sc: Scene, sq: Dict[str, Any], x0: float, y: float,
                total_w: float) -> float:
    """SECTION B: pillars, requirements band, open questions."""
    sc.hline(x0, y, total_w, stroke=INK, stroke_width=2, roughness=1)
    y += 28
    y = draw_title_block(sc, x0, y, total_w, sq.get("title"), FS_SECTION_TITLE,
                         sq.get("subtitle"), FS_SECTION_SUB)
    y += 22

    pillars = list(sq.get("pillars") or [])
    col_bottom = y
    if pillars:
        n = len(pillars)
        col_w = (total_w - (n - 1) * GAP) / float(n)

        # header heights are equalised across the row
        heads = []
        for p in pillars:
            inner = col_w - 2 * PAD
            name = wrap_text(p.get("name"), inner, FS_HEADER)
            why = wrap_text(p.get("why"), inner, FS_BODY)
            h = PAD + block_size(name, FS_HEADER)[1]
            if why:
                h += 6 + block_size(why, FS_BODY)[1]
            h += PAD
            heads.append({"name": name, "why": why, "height": h})
        head_h = max(h["height"] for h in heads)

        for pi, p in enumerate(pillars):
            stroke, bg = pal(p.get("color"))
            px = x0 + pi * (col_w + GAP)
            hd = heads[pi]
            g = sc.uid("g-pillar")
            sc.rect(px, y, col_w, head_h, stroke, bg, stroke_width=2, group=g,
                    prefix="pillarhdr")
            hy = y + PAD
            sc.text(px + PAD, hy, hd["name"], FS_HEADER, color=INK, group=g,
                    prefix="pillarname")
            hy += block_size(hd["name"], FS_HEADER)[1]
            if hd["why"]:
                hy += 6
                sc.text(px + PAD, hy, hd["why"], FS_BODY, color=MUTED,
                        group=g, prefix="pillarwhy")

            fy = y + head_h + 12
            for feat in (p.get("features") or []):
                m = measure_feature(feat, col_w)
                prio = str(feat.get("priority") or "P2").upper()
                gf = sc.uid("g-feat")
                sc.rect(px, fy, col_w, m["height"], stroke, WHITE,
                        stroke_width=2 if prio == "P0" else 1,
                        group=gf, prefix="feat")
                sc.text(px + PAD, fy + PAD, m["name"], FS_CARD_TITLE,
                        color=INK, group=gf, prefix="featname")
                draw_badge(sc, px + col_w - PAD - BADGE_W, fy + PAD, prio, gf)
                iy = fy + PAD + m["top_h"]
                if m["detail"]:
                    iy += 6
                    sc.text(px + PAD, iy, m["detail"], FS_BODY, color=MUTED,
                            group=gf, prefix="featdetail")
                fy += m["height"] + 10
            col_bottom = max(col_bottom, fy - 10)
    y = col_bottom + SECTION_GAP / 2.0

    # ---- requirements band (wraps every REQ_PER_ROW categories) -----------
    reqs = list(sq.get("requirements") or [])
    if reqs:
        y = draw_title_block(sc, x0, y, total_w, "Requirements", FS_HEADER,
                             None, FS_BODY, title_color=INK)
        y += 12
        # 4 per row, but never so many that a panel becomes unreadably narrow
        per_row = min(REQ_PER_ROW, len(reqs),
                      max(1, int((total_w + GAP) // (MIN_PANEL_W + GAP))))
        panel_w = (total_w - (per_row - 1) * GAP) / float(per_row)
        for start in range(0, len(reqs), per_row):
            chunk = reqs[start:start + per_row]
            measures = []
            for j, r in enumerate(chunk):
                lines = bullet_lines(r.get("items") or [], panel_w - 2 * PAD,
                                     FS_BODY)
                m = measure_panel(r.get("category") or "", lines, panel_w,
                                  title_fs=FS_CARD_TITLE)
                color = COLOR_CYCLE[(start + j) % len(COLOR_CYCLE)]
                measures.append((m, color))
            row_h = max(m["height"] for m, _ in measures)
            for j, (m, color) in enumerate(measures):
                m = dict(m)
                m["height"] = row_h
                stroke, bg = pal(color)
                draw_panel(sc, x0 + j * (panel_w + GAP), y, panel_w, m,
                           stroke, bg, group=sc.uid("g-req"),
                           title_fs=FS_CARD_TITLE)
            y += row_h + GAP
        y -= GAP

    # ---- open questions ---------------------------------------------------
    oq = list(sq.get("openQuestions") or [])
    if oq:
        y += SECTION_GAP / 2.0
        lines = bullet_lines(oq, total_w - 2 * PAD, FS_BODY, marker="? ")
        m = measure_panel("Open questions", lines, total_w, title_fs=FS_HEADER)
        stroke, bg = pal("teal")
        y = draw_panel(sc, x0, y, total_w, m, stroke, bg,
                       group=sc.uid("g-oq"))
    return y


def build(content: Dict[str, Any]) -> Dict[str, Any]:
    sc = Scene()
    plan = content.get("plan") or {}
    days = plan.get("days") or []
    # section A is exactly as wide as its own grid; section B never narrower
    # than MIN_BOARD_W, so a short plan cannot squeeze the pillars into noodles.
    grid_w = grid_width(len(days))
    content_w = max(grid_w, MIN_BOARD_W)
    x0, y = 0.0, 0.0

    board = content.get("board") or {}
    y = draw_title_block(sc, x0, y, content_w, board.get("title"),
                         FS_BOARD_TITLE, board.get("subtitle"), FS_BOARD_SUB)
    y += SECTION_GAP

    y = draw_plan(sc, plan, x0, y, grid_w)
    y += SECTION_GAP

    squash = content.get("squash") or {}
    if squash:
        draw_squash(sc, squash, x0, y, content_w)

    return {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": sc.elements,
        "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
        "files": {},
    }


# --------------------------------------------------------------------------
# self-check
# --------------------------------------------------------------------------

def _box(el: Dict[str, Any]) -> Tuple[float, float, float, float]:
    return (el["x"], el["y"], el["x"] + el["width"], el["y"] + el["height"])


def _overlap(a, b, tol: float = 0.5) -> bool:
    return (a[0] < b[2] - tol and b[0] < a[2] - tol
            and a[1] < b[3] - tol and b[1] < a[3] - tol)


def _contains(outer, inner, tol: float = 2.0) -> bool:
    return (outer[0] <= inner[0] + tol and outer[1] <= inner[1] + tol
            and outer[2] >= inner[2] - tol and outer[3] >= inner[3] - tol)


def self_check(path: str) -> int:
    with open(path, "r", encoding="utf-8") as fh:
        scene = json.load(fh)

    errors: List[str] = []
    print("self-check: reading %s" % path)

    for key, want in (("type", "excalidraw"), ("version", 2),
                      ("source", "https://excalidraw.com")):
        if scene.get(key) != want:
            errors.append("top-level %r is %r, expected %r"
                          % (key, scene.get(key), want))
    for key in ("elements", "appState", "files"):
        if key not in scene:
            errors.append("missing top-level key %r" % key)

    els = scene.get("elements") or []
    kinds: Dict[str, int] = {}
    for el in els:
        kinds[el.get("type", "?")] = kinds.get(el.get("type", "?"), 0) + 1
    print("self-check: %d elements (%s)"
          % (len(els), ", ".join("%s=%d" % kv for kv in sorted(kinds.items()))))

    # 1. required keys
    for el in els:
        missing = [k for k in REQUIRED_BASE_KEYS if k not in el]
        if el.get("type") == "text":
            missing += [k for k in REQUIRED_TEXT_KEYS if k not in el]
        if el.get("type") in ("line", "arrow"):
            missing += [k for k in REQUIRED_LINEAR_KEYS if k not in el]
        if missing:
            errors.append("element %s (%s) missing keys: %s"
                          % (el.get("id"), el.get("type"), ", ".join(missing)))
    if not errors:
        print("self-check: required key set OK on all %d elements" % len(els))

    # 2. unique ids
    ids = [el.get("id") for el in els]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        errors.append("duplicate element ids: %s" % dupes[:10])
    else:
        print("self-check: %d unique element ids OK" % len(ids))

    # 3. no two rectangles overlap unless one fully contains the other.
    #    Rectangles whose vertical spans overlap are, by construction, siblings
    #    in the same row -- so this subsumes the row-sibling requirement.
    rects = [el for el in els if el.get("type") == "rectangle"]
    boxes = [(el["id"], _box(el)) for el in rects]
    row_pairs = 0
    bad = 0
    for i in range(len(boxes)):
        ida, a = boxes[i]
        for j in range(i + 1, len(boxes)):
            idb, b = boxes[j]
            if not (a[1] < b[3] and b[1] < a[3]):
                continue  # not on the same horizontal band
            row_pairs += 1
            if _overlap(a, b) and not (_contains(a, b) or _contains(b, a)):
                bad += 1
                if bad <= 8:
                    errors.append("row-sibling rectangles overlap: %s %s / %s %s"
                                  % (ida, a, idb, b))
    print("self-check: %d rectangles, %d same-row sibling pairs, %d overlaps"
          % (len(rects), row_pairs, bad))

    # 4. every text block stays inside any rectangle it touches
    texts = [el for el in els if el.get("type") == "text"]
    contained = 0
    spill = 0
    for t in texts:
        tb = _box(t)
        for rid, rb in boxes:
            if _overlap(tb, rb):
                if _contains(rb, tb):
                    contained += 1
                else:
                    spill += 1
                    if spill <= 8:
                        errors.append("text %s spills out of rectangle %s: %s vs %s"
                                      % (t.get("id"), rid, tb, rb))
    print("self-check: %d text elements, %d text-in-box containments, %d spills"
          % (len(texts), contained, spill))

    # 5. bounding box
    if els:
        xs0 = min(el["x"] for el in els)
        ys0 = min(el["y"] for el in els)
        xs1 = max(el["x"] + el["width"] for el in els)
        ys1 = max(el["y"] + el["height"] for el in els)
        print("self-check: bounding box x=[%.1f, %.1f] y=[%.1f, %.1f] -> %.0f x %.0f px"
              % (xs0, xs1, ys0, ys1, xs1 - xs0, ys1 - ys0))

    if errors:
        print("self-check: FAIL (%d problems)" % len(errors))
        for e in errors[:30]:
            print("  - %s" % e)
        return 1
    print("self-check: PASS")
    return 0


# --------------------------------------------------------------------------

USAGE = ("usage: python3 excalidraw_board.py <content.json> <out.excalidraw> "
         "[--self-check]\n"
         "       python3 excalidraw_board.py --self-check <existing.excalidraw>")


def main(argv: List[str]) -> int:
    args = [a for a in argv[1:]]
    if len(args) == 2 and args[0] == "--self-check":
        return self_check(args[1])
    args = [a for a in args if a != "--self-check"]
    if len(args) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    src, dst = args
    with open(src, "r", encoding="utf-8") as fh:
        content = json.load(fh)
    scene = build(content)
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(scene, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print("wrote %s (%d elements)" % (dst, len(scene["elements"])))
    return self_check(dst)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
