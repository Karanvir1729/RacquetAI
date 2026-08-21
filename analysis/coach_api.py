"""
The coach: Azure OpenAI, behind the same auth wall as everything else.

Why this lives on the server and not in the browser
---------------------------------------------------
An Azure OpenAI key in a Vite bundle is a public key. Anyone reading
`view-source` could spend the subscription's tokens. So the browser never sees
it: it sends a bearer token we already trust (Supabase), and this module holds
the key and does the talking.

What the coach is allowed to claim
----------------------------------
This is the part that matters more than the plumbing. The analysis behind it is
honest about being approximate: shot classes come from body pose with no ball
tracking, and shot detection was audited at 63% precision on club footage. A
coach that reads those numbers back as fact would be inventing certainty the
product deliberately refuses to claim elsewhere.

So the system prompt is built to (a) receive the measurements with their error
bars attached, and (b) be told, explicitly, which quantities are reliable
(court coverage, T-time, rally lengths — these come from position and timing)
and which are indicative only (shot classes and the shot mix). The prompt asks
for the honest version of the advice, not the confident one.

Cost
----
Every call is capped: history is trimmed, `max_tokens` is bounded, and a
per-user token budget per rolling hour stops one account emptying the
subscription. The budget is in-process — good enough for a single container,
and the thing it is guarding against is a runaway loop, not a determined
attacker (who still has to get past auth first).
"""
import collections
import json
import os
import threading
import time

import requests
from flask import Blueprint, jsonify, request

from platform_api import _auth_user, _sb_headers, SUPABASE_URL

coach_bp = Blueprint("coach", __name__)

ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
API_KEY = os.environ.get("AZURE_OPENAI_KEY", "")
DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "coach")
API_VERSION = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21")

def coach_configured():
    return bool(ENDPOINT and API_KEY)

# ------------------------------------------------------------------ budget
# tokens per user per rolling hour; a full coaching exchange is ~1-2k.
HOURLY_TOKEN_BUDGET = int(os.environ.get("COACH_HOURLY_TOKENS", "60000"))
_spend = collections.defaultdict(list)   # user_id -> [(when, tokens), ...]
_spend_lock = threading.Lock()

def _spent_last_hour(user_id):
    cutoff = time.time() - 3600
    with _spend_lock:
        rows = [r for r in _spend[user_id] if r[0] > cutoff]
        _spend[user_id] = rows
        return sum(t for _, t in rows)

def _record_spend(user_id, tokens):
    with _spend_lock:
        _spend[user_id].append((time.time(), tokens))

# ------------------------------------------------------------------ context
MAX_HISTORY = 16          # turns kept from the client's transcript
MAX_CHARS_PER_MSG = 4000  # a pasted essay must not blow the context

def _profile_for(token):
    """The player's own profile row, read under THEIR token so RLS applies."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/player_profiles",
            headers=_sb_headers(token),
            params={"select": "*", "limit": "1"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception:
        return None


def _describe_profile(p):
    if not p:
        return "The player has not filled in a profile yet. Ask for what you need before assuming."
    bits = []
    if p.get("display_name"):   bits.append(f"Name: {p['display_name']}")
    if p.get("level"):          bits.append(f"Standard: {p['level']}")
    if p.get("years_playing") is not None: bits.append(f"Playing for {p['years_playing']} years")
    if p.get("plays_per_week") is not None: bits.append(f"Plays {p['plays_per_week']}x/week")
    if p.get("dominant_hand"):  bits.append(f"{p['dominant_hand']}-handed")
    if p.get("height_cm"):      bits.append(f"{p['height_cm']}cm")
    if p.get("goals"):          bits.append(f"Their stated goal: {p['goals']}")
    if p.get("injuries"):       bits.append(f"Injuries/limitations: {p['injuries']}")
    return "\n".join(f"- {b}" for b in bits)


PRETTY_CELL = {"frontLeft": "front left", "frontRight": "front right",
               "backLeft": "back left", "backRight": "back right"}


def _pct(part, whole):
    return round(100.0 * part / whole) if whole else 0


def _shot_mix(shots, player_id):
    """Shot types for one player, as percentages. The writer omits `type` when
    it could not classify, so unclassified shots are excluded from the base
    rather than silently counted as something."""
    counts = {}
    total = 0
    for s in shots:
        if not isinstance(s, dict) or s.get("player") != player_id:
            continue
        kind = s.get("type")
        if not kind:
            continue
        counts[kind] = counts.get(kind, 0) + 1
        total += 1
    if not total:
        return None
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return ", ".join(f"{k} {_pct(v, total)}%" for k, v in ranked)


def _describe_analysis(a):
    """Flatten one MatchAnalysis into the numbers a coach would actually use.

    Field names are the schema's, checked against a real analysis.json rather
    than assumed: `tTimePct` not `tPct`, `bothPlayersDetectedPct` not a pose
    coverage field, `placement` is a dict of counts per court cell, and there
    is no shot-mix field at all — it is derived from `shots[]` by `type`.
    """
    if not isinstance(a, dict):
        return None
    players = a.get("players")
    if not isinstance(players, list) or not players:
        return None
    try:
        v = a.get("video") or {}
        r = a.get("rallies") or {}
        q = a.get("quality") or {}
        shots = a.get("shots") or []
        lines = [
            f"Footage: {round(v.get('durationSec') or 0)}s at {v.get('width')}x{v.get('height')}",
            f"Rallies: {r.get('count')}, mean {r.get('avgShotsPerRally')} shots per rally, "
            f"longest {r.get('longestRally')} shots",
            f"Total shots detected: {len(shots)}",
            f"Both players visible in {q.get('bothPlayersDetectedPct')}% of "
            f"{q.get('framesAnalyzed')} analysed frames",
        ]
        if q.get("audioAvailable") is False:
            lines.append("No audio track — rally boundaries are far less reliable on this one.")

        for pl in players:
            if not isinstance(pl, dict):
                continue
            name = pl.get("label") or pl.get("id") or "Player"
            lines.append("")
            lines.append(f"{name}: {pl.get('shots')} shots, "
                         f"{pl.get('tTimePct')}% of frames within 1.5m of the T")

            placement = pl.get("placement")
            if isinstance(placement, dict) and placement:
                total = sum(x for x in placement.values() if isinstance(x, (int, float)))
                if total:
                    cells = ", ".join(
                        f"{PRETTY_CELL.get(k, k)} {_pct(val, total)}%"
                        for k, val in sorted(placement.items(), key=lambda kv: -kv[1])
                    )
                    lines.append(f"  where their shots landed: {cells}")

            mix = _shot_mix(shots, pl.get("id"))
            if mix:
                lines.append(f"  shot mix (INDICATIVE ONLY, ~63% precision): {mix}")

            pred = pl.get("predictability")
            if isinstance(pred, dict) and isinstance(pred.get("score"), (int, float)):
                lines.append(
                    f"  predictability {round(pred['score'] * 100)}% "
                    f"({pred.get('entropyBits')} of {pred.get('maxEntropyBits')} bits of "
                    f"shot-choice entropy; most common pattern: {pred.get('topPattern')})"
                )

        notes = q.get("notes")
        if isinstance(notes, list) and notes:
            lines.append("")
            lines.append("Caveats the analyser itself reported:")
            for n in notes[:4]:
                if isinstance(n, str):
                    lines.append(f"  - {n}")
        return "\n".join(lines)
    except Exception:
        return None


SYSTEM = """You are a squash coach embedded in RacketIQ, an app that measures squash matches from video.

HOW TO SPEAK
Talk like a good club coach standing on the balcony after a match: direct, specific, warm but not gushing. Short paragraphs. No bullet-point avalanches, no bold-word salad, no "great question!". Never more than ~200 words unless asked for more. Give ONE main thing to work on, then at most two supporting notes.

WHAT YOU CAN AND CANNOT TRUST
The measurements you are given come from pose estimation on a fixed camera. That means:
- RELIABLE: court coverage, time spent near the T, rally counts and lengths, how long the match ran, where players physically were. These come from position and timing.
- INDICATIVE ONLY: shot classes (drive/drop/boast/volley) and the shot mix. They are inferred from body pose with NO ball tracking, audited at about 63% precision on club-grade footage. Treat them as a hint about tendencies, never as a count of what was hit.
- NOT MEASURED AT ALL: the ball, the score, who won, shot quality, tin-finding, height on the front wall, whether a drop was good or loose.

So: build your advice on movement and positioning, use shot-mix as a soft signal, and never state a shot-level fact as certain. If someone asks you something the data cannot answer, say so plainly in one sentence and offer what you CAN see instead. Never invent a number you were not given.

COACHING
Connect what you see to what to actually do: a drill, a habit, a thing to feel. If the player's profile gives a goal or an injury, respect it. If you genuinely do not have enough to go on, ask one good question rather than guessing."""


def _messages(profile, analysis, history, user_msg):
    system = SYSTEM
    system += "\n\nTHE PLAYER\n" + _describe_profile(profile)
    described = _describe_analysis(analysis)
    if described:
        system += "\n\nTHEIR MOST RECENT ANALYSED MATCH\n" + described
    else:
        system += "\n\nNo match analysis is attached to this conversation."

    msgs = [{"role": "system", "content": system}]
    for m in (history or [])[-MAX_HISTORY:]:
        role = m.get("role")
        content = (m.get("content") or "")[:MAX_CHARS_PER_MSG]
        if role in ("user", "assistant") and content:
            msgs.append({"role": role, "content": content})
    if user_msg:
        msgs.append({"role": "user", "content": user_msg[:MAX_CHARS_PER_MSG]})
    return msgs


def _call_openai(messages, max_tokens):
    url = f"{ENDPOINT}/openai/deployments/{DEPLOYMENT}/chat/completions?api-version={API_VERSION}"
    r = requests.post(
        url,
        headers={"Content-Type": "application/json", "api-key": API_KEY},
        json={"messages": messages, "max_tokens": max_tokens, "temperature": 0.7},
        timeout=90,
    )
    if r.status_code != 200:
        # Never surface the upstream body: it can echo request content and, on
        # some errors, configuration detail the browser has no business seeing.
        raise RuntimeError(f"upstream {r.status_code}")
    body = r.json()
    text = (body["choices"][0]["message"]["content"] or "").strip()
    used = (body.get("usage") or {}).get("total_tokens", 0)
    return text, used


def _guard():
    """(user, token, None) when the caller may proceed, else (None, None, resp)."""
    if not coach_configured():
        return None, None, (jsonify({"error": "The coach is not configured on this server."}), 503)
    user = _auth_user()
    if user is None:
        return None, None, (jsonify({"error": "Sign in to talk to the coach."}), 401)
    header = request.headers.get("Authorization", "")
    token = header[len("Bearer "):].strip() if header.startswith("Bearer ") else ""
    if _spent_last_hour(user["id"]) >= HOURLY_TOKEN_BUDGET:
        return None, None, (jsonify({"error": "You have reached this hour's coaching limit. Try again shortly."}), 429)
    return user, token, None


@coach_bp.route("/coach/<path:_sub>", methods=["OPTIONS"])
def _coach_preflight(_sub=None):
    return ("", 204)


@coach_bp.route("/coach/status")
def coach_status():
    return jsonify({"configured": coach_configured()})


@coach_bp.route("/coach/chat", methods=["POST"])
def coach_chat():
    user, token, denied = _guard()
    if denied is not None:
        return denied
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Say something to the coach."}), 400
    msgs = _messages(_profile_for(token), body.get("analysis"), body.get("history"), message)
    try:
        reply, used = _call_openai(msgs, max_tokens=600)
    except Exception:
        return jsonify({"error": "The coach could not be reached. Try again in a moment."}), 502
    _record_spend(user["id"], used)
    return jsonify({"reply": reply})


FEEDBACK_ASK = """Give this player their post-match debrief from the measurements above.

Open with the single most useful observation about how they moved — not a summary of the numbers, an observation. Then what to work on, concretely enough to take onto a court tomorrow. Then one thing that looks good, if something does.

Do not list every statistic back at them. They can see the numbers; what they cannot see is what the numbers mean."""


@coach_bp.route("/coach/feedback", methods=["POST"])
def coach_feedback():
    user, token, denied = _guard()
    if denied is not None:
        return denied
    body = request.get_json(silent=True) or {}
    analysis = body.get("analysis")
    if _describe_analysis(analysis) is None:
        return jsonify({"error": "A match analysis is needed for a feedback session."}), 400
    msgs = _messages(_profile_for(token), analysis, [], FEEDBACK_ASK)
    try:
        reply, used = _call_openai(msgs, max_tokens=700)
    except Exception:
        return jsonify({"error": "The coach could not be reached. Try again in a moment."}), 502
    _record_spend(user["id"], used)
    return jsonify({"feedback": reply})
