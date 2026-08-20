#!/usr/bin/env python3
"""RacquetAI local analysis server.

Bridges the Expo app to the offline pipeline (analyze.py). API contract
(base default http://localhost:8082):

  POST /jobs                  multipart/form-data field "video" (mp4/mov)
                              -> {"jobId": "..."}
  GET  /jobs/<id>             -> {"status": "queued"|"preparing"|"corners_needed"
                                  |"analyzing"|"done"|"error",
                                  "progressPct": number|null,
                                  "message": string|null}
  GET  /jobs/<id>/frame.jpg   mid-video reference frame (from corners_needed on)
  POST /jobs/<id>/corners     JSON {"frontLeft":[nx,ny], "frontRight":[nx,ny],
                                    "backLeft":[nx,ny], "backRight":[nx,ny]}
                              coords normalized relative to frame.jpg (origin
                              top-left; values may fall outside 0..1 because
                              court corners can sit outside the camera frame)
                              -> {"ok": true}, status moves to "analyzing"
  GET  /jobs/<id>/analysis.json   schemaVersion-2 MatchAnalysis once "done"

Flow: upload -> preparing (ffmpeg downscale to width<=854 + wav extract +
reference mid-frame) -> corners_needed (always; tap-the-corners is the product
flow) -> analyzing (analyze.py subprocess) -> done.

Jobs live under analysis/jobs/<jobId>/ (gitignored). One background thread per
phase per job; state is persisted to state.json so a restarted server can still
answer status/artifact GETs for old jobs.

Run:  analysis/.venv/bin/python analysis/server.py   (port 8082)
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

from flask import Flask, jsonify, request, send_file

from platform_api import _auth_user, _configured, platform_bp

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
JOBS_DIR = os.path.join(ANALYSIS_DIR, "jobs")
VENV_PY = os.path.join(ANALYSIS_DIR, ".venv", "bin", "python")
ANALYZE_PY = os.path.join(ANALYSIS_DIR, "analyze.py")
# Resolve from PATH (Linux containers: /usr/bin), keeping the Homebrew
# location as a fallback for a bare `python server.py` on a Mac without
# ffmpeg on PATH.
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"

PORT = int(os.environ.get("RACQUET_ANALYSIS_PORT", "8082"))
DOWNSCALE_W = 854
ALLOWED_EXT = {".mp4", ".mov"}
CORNER_KEYS = ("frontLeft", "frontRight", "backLeft", "backRight")
COURT_W, COURT_L = 6.4, 9.75

# analyze.py pass-1 progress lines look like "  ... 12s / 452s"
PROGRESS_RE = re.compile(r"\.\.\.\s*([\d.]+)s\s*/\s*([\d.]+)s")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024  # 4 GB uploads
app.register_blueprint(platform_bp)  # /billing/* + /admin/* (platform_api.py)

jobs = {}          # jobId -> dict (see _new_job)
jobs_lock = threading.Lock()


# ---------------------------------------------------------------- job state
def _job_dir(job_id):
    return os.path.join(JOBS_DIR, job_id)


def _new_job(job_id, source_name):
    return {
        "id": job_id,
        "status": "queued",
        "message": None,
        "sourceName": source_name,
        # Set by create_job from the verified token; persisted in state.json so a
        # restarted server still knows whose job this is.
        "ownerId": None,
        "createdAt": time.time(),
        # filled in during "preparing"
        "videoW": None, "videoH": None, "durationSec": None, "refTimeSec": None,
        # analyzing-phase progress bookkeeping
        "analyzeStartedAt": None,
        "poseProgress": None,      # (t, total) parsed from analyze.py stdout
    }


def _persist(job):
    """Write a restart-survivable snapshot (best effort)."""
    try:
        with open(os.path.join(_job_dir(job["id"]), "state.json"), "w") as f:
            json.dump(job, f, indent=2)
    except OSError:
        pass


def _set(job, status=None, message=None, **extra):
    with jobs_lock:
        if status is not None:
            job["status"] = status
        job["message"] = message
        job.update(extra)
        snapshot = dict(job)
    _persist(snapshot)


def _load_existing_jobs():
    """On startup, resurrect finished/parked jobs; mark mid-flight ones failed."""
    if not os.path.isdir(JOBS_DIR):
        return
    for job_id in os.listdir(JOBS_DIR):
        path = os.path.join(JOBS_DIR, job_id, "state.json")
        try:
            with open(path) as f:
                job = json.load(f)
        except (OSError, ValueError):
            continue
        if job.get("status") in ("queued", "preparing", "analyzing"):
            job["status"] = "error"
            job["message"] = "server restarted while the job was in flight; re-upload"
        jobs[job_id] = job


# ---------------------------------------------------------------- helpers
def _run(cmd, timeout=600):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def _probe_video(path):
    r = _run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
              "stream=width,height", "-show_entries", "format=duration",
              "-of", "json", path])
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {r.stderr.strip()[:400]}")
    info = json.loads(r.stdout)
    streams = info.get("streams") or []
    if not streams:
        raise RuntimeError("no video stream found")
    w, h = int(streams[0]["width"]), int(streams[0]["height"])
    duration = float(info.get("format", {}).get("duration") or 0.0)
    if duration <= 0:
        raise RuntimeError("could not determine video duration")
    return w, h, duration


def _tail(text, n=6, limit=700):
    lines = [ln for ln in (text or "").strip().splitlines() if ln.strip()]
    return " | ".join(lines[-n:])[:limit]


# ---------------------------------------------------------------- phase: prepare
def _prepare_worker(job):
    d = _job_dir(job["id"])
    try:
        _set(job, status="preparing", message="downscaling video")
        src = job["inputPath"]
        video = os.path.join(d, "video.mp4")
        r = _run([FFMPEG, "-y", "-v", "error", "-i", src,
                  "-vf", f"scale='min({DOWNSCALE_W},iw)':-2",
                  "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                  "-pix_fmt", "yuv420p",
                  # First video + first audio stream ONLY. iPhone originals
                  # carry extra timed-metadata/no-codec streams that "0:a?"
                  # sweeps in and ffmpeg then fails to find a decoder for.
                  "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-c:a", "aac",
                  "-movflags", "+faststart", video], timeout=1800)
        if r.returncode != 0:
            raise RuntimeError(f"ffmpeg downscale failed: {_tail(r.stderr)}")

        w, h, duration = _probe_video(video)

        # wav extract (best effort — analyze.py re-extracts; this validates audio
        # early and matches the documented preparing stage)
        _run([FFMPEG, "-y", "-v", "error", "-i", video, "-vn", "-ac", "1",
              "-ar", "22050", os.path.join(d, "audio.wav")])

        ref_t = round(duration / 2.0, 2)
        r = _run([FFMPEG, "-y", "-v", "error", "-ss", str(ref_t), "-i", video,
                  "-frames:v", "1", "-q:v", "2", os.path.join(d, "frame.jpg")])
        if r.returncode != 0 or not os.path.exists(os.path.join(d, "frame.jpg")):
            raise RuntimeError(f"reference frame extraction failed: {_tail(r.stderr)}")

        # meta sidecar analyze.py picks up for analysis.json provenance
        with open(os.path.join(d, "video.meta.json"), "w") as f:
            json.dump({"source": job.get("sourceName") or "upload",
                       "license": "user-provided recording"}, f)

        _set(job, status="corners_needed",
             message="tap the 4 court-floor corners on frame.jpg",
             videoW=w, videoH=h, durationSec=round(duration, 3), refTimeSec=ref_t)
    except Exception as e:  # noqa: BLE001 — every failure must land in the job
        _set(job, status="error", message=f"preparing failed: {e}")


# ---------------------------------------------------------------- phase: analyze
def _analyze_worker(job):
    d = _job_dir(job["id"])
    out_dir = os.path.join(d, "out")
    os.makedirs(out_dir, exist_ok=True)
    log_path = os.path.join(d, "analyze.log")
    try:
        _set(job, status="analyzing", message="running pose + shot analysis",
             analyzeStartedAt=time.time(), poseProgress=None)
        env = dict(os.environ)
        env["PATH"] = "/opt/homebrew/bin:" + env.get("PATH", "")
        cmd = [VENV_PY, "-u", ANALYZE_PY,
               "--video", os.path.join(d, "video.mp4"),
               "--corners", os.path.join(d, "corners.json"),
               "--out", out_dir]
        with open(log_path, "w") as log:
            proc = subprocess.Popen(cmd, cwd=ANALYSIS_DIR, env=env,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True)
            for line in proc.stdout:
                log.write(line)
                log.flush()
                m = PROGRESS_RE.search(line)
                if m:
                    with jobs_lock:
                        job["poseProgress"] = (float(m.group(1)), float(m.group(2)))
            proc.wait()
        analysis_path = os.path.join(out_dir, "analysis.json")
        if proc.returncode != 0 or not os.path.exists(analysis_path):
            with open(log_path) as f:
                raise RuntimeError(f"analyze.py exit {proc.returncode}: {_tail(f.read())}")
        with open(analysis_path) as f:
            json.load(f)  # refuse to go "done" on unparseable output
        _set(job, status="done", message=None)
    except Exception as e:  # noqa: BLE001
        _set(job, status="error", message=f"analysis failed: {e}")


def _progress_pct(job):
    status = job["status"]
    if status == "done":
        return 100
    if status == "queued":
        return 0
    if status == "preparing":
        return 5
    if status != "analyzing":
        return None
    # pose pass 1 dominates runtime; blend the parsed stdout progress with an
    # elapsed-time estimate and never claim more than 95 until "done".
    pct = 5.0
    if job.get("poseProgress"):
        t, total = job["poseProgress"]
        if total > 0:
            pct = max(pct, 5.0 + 85.0 * min(t / total, 1.0))
    started = job.get("analyzeStartedAt")
    if started:
        est_total = 30.0 + 10.0 * float(job.get("durationSec") or 60.0)
        pct = max(pct, 95.0 * min((time.time() - started) / est_total, 1.0))
    return round(min(pct, 95.0), 1)


# ---------------------------------------------------------------- HTTP layer
@app.after_request
def _cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    # X-Filename rides on the raw-body upload the web client uses; omitting it
    # here makes the browser preflight fail and every cross-origin upload dies.
    # Authorization carries Supabase tokens (/billing) and admin basic auth.
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Filename, Authorization"
    return resp


@app.route("/jobs/<path:_sub>", methods=["OPTIONS"])
@app.route("/jobs", methods=["OPTIONS"])
def _preflight(_sub=None):
    return "", 204


def _get_job(job_id):
    with jobs_lock:
        return jobs.get(job_id)


# ---------------------------------------------------------------- job auth
#
# Every /jobs route is authenticated. Before this, the whole analysis API was
# open to anyone who knew the hostname: a stranger could POST a 4 GB video and
# spend the operator's Azure compute, and could read back any job's reference
# frame and analysis by guessing an id.
#
# FAIL CLOSED is the point. If the platform is not configured (no
# SUPABASE_URL / service key) there is no way to verify a token, so jobs are
# refused rather than waved through — the previous behaviour is exactly the
# hole being closed. A LAN/desktop install that genuinely has no accounts opts
# in explicitly with ALLOW_ANONYMOUS_JOBS=1.
ALLOW_ANONYMOUS_JOBS = os.environ.get("ALLOW_ANONYMOUS_JOBS", "") == "1"


def _require_user():
    """
    (user_id, None) when the caller may use /jobs, else (None, response).

    `user_id` is None in the explicitly-opted-in anonymous mode, which also
    disables the per-owner checks below — one trusted user on a LAN.
    """
    if ALLOW_ANONYMOUS_JOBS:
        return None, None
    if not _configured():
        return None, (jsonify({
            "error": "This analysis server is not configured for accounts, so it "
                     "cannot accept uploads. Set SUPABASE_URL and "
                     "SUPABASE_SERVICE_ROLE_KEY, or run it with "
                     "ALLOW_ANONYMOUS_JOBS=1 on a trusted network."
        }), 503)
    user = _auth_user()
    if user is None:
        return None, (jsonify({"error": "Sign in to analyse a video."}), 401)
    return user.get("id"), None


def _owns(job, user_id):
    """
    May this caller see this job?

    Anonymous mode has no owners. Otherwise a job is visible only to the
    account that created it — a guessed job id must not hand over someone
    else's court footage.
    """
    if ALLOW_ANONYMOUS_JOBS:
        return True
    return job.get("ownerId") is not None and job.get("ownerId") == user_id


def _guard_job(job_id):
    """(job, user_id, None) or (None, None, response). Used by every read route."""
    user_id, denied = _require_user()
    if denied is not None:
        return None, None, denied
    job = _get_job(job_id)
    if job is None:
        return None, None, (jsonify({"error": "unknown job"}), 404)
    if not _owns(job, user_id):
        # 404, not 403: a stranger probing ids learns nothing about which ones
        # exist.
        return None, None, (jsonify({"error": "unknown job"}), 404)
    return job, user_id, None


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "racquetai-analysis", "port": PORT})


@app.route("/jobs", methods=["POST"])
def create_job():
    # Authenticate BEFORE reading the body: a rejected upload must cost the
    # server nothing, and Flask has not spooled the file at this point.
    owner_id, denied = _require_user()
    if denied is not None:
        return denied

    # Two upload shapes: multipart field "video" (curl, older app builds) or a
    # raw video/* body (app build 11+). Raw exists because expo's iOS multipart
    # implementation buffers the whole file in memory before sending — a match
    # video is a multi-hundred-MB spike that killed the app on device.
    f = request.files.get("video")
    ctype = (request.content_type or "").lower()
    if f is not None and f.filename:
        src_name = f.filename
        ext = os.path.splitext(src_name)[1].lower() or ".mp4"
    elif ctype.startswith("video/"):
        src_name = request.headers.get("X-Filename") or "upload"
        ext = ".mov" if "quicktime" in ctype else ".mp4"
    else:
        return jsonify({"error": 'multipart field "video" (mp4/mov) or a raw '
                                 "video/* body is required"}), 400
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"unsupported extension {ext}; use mp4 or mov"}), 400

    job_id = uuid.uuid4().hex[:12]
    d = _job_dir(job_id)
    os.makedirs(d, exist_ok=True)
    input_path = os.path.join(d, "input" + ext)
    if f is not None and f.filename:
        f.save(input_path)
    else:
        with open(input_path, "wb") as out:
            shutil.copyfileobj(request.stream, out, length=1024 * 1024)
    if os.path.getsize(input_path) == 0:
        return jsonify({"error": "uploaded video is empty"}), 400

    job = _new_job(job_id, os.path.basename(src_name))
    job["inputPath"] = input_path
    # Bound to the account that uploaded it. Every read route checks this, so a
    # guessed job id cannot hand someone else's footage or analysis over.
    job["ownerId"] = owner_id
    with jobs_lock:
        jobs[job_id] = job
    _persist(job)
    threading.Thread(target=_prepare_worker, args=(job,), daemon=True).start()
    return jsonify({"jobId": job_id}), 201


@app.route("/jobs/<job_id>")
def job_status(job_id):
    job, _user, denied = _guard_job(job_id)
    if denied is not None:
        return denied
    with jobs_lock:
        snapshot = dict(job)
    return jsonify({"status": snapshot["status"],
                    "progressPct": _progress_pct(snapshot),
                    "message": snapshot.get("message")})


@app.route("/jobs/<job_id>/frame.jpg")
def job_frame(job_id):
    job, _user, denied = _guard_job(job_id)
    if denied is not None:
        return denied
    path = os.path.join(_job_dir(job_id), "frame.jpg")
    if job["status"] in ("queued", "preparing") or not os.path.exists(path):
        return jsonify({"error": "frame not ready (available from corners_needed)"}), 409
    return send_file(path, mimetype="image/jpeg")


@app.route("/jobs/<job_id>/corners", methods=["POST"])
def job_corners(job_id):
    job, _user, denied = _guard_job(job_id)
    if denied is not None:
        return denied
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON body required"}), 400

    norm = {}
    for key in CORNER_KEYS:
        v = data.get(key)
        if (not isinstance(v, (list, tuple)) or len(v) != 2
                or not all(isinstance(c, (int, float)) for c in v)):
            return jsonify({"error": f'"{key}" must be [nx, ny] normalized to '
                                     f"frame.jpg (origin top-left)"}), 400
        norm[key] = (float(v[0]), float(v[1]))

    # atomic check-and-flip so a double POST cannot spawn two analyze threads
    with jobs_lock:
        if job["status"] != "corners_needed":
            status = job["status"]
            claim_ok = False
        else:
            job["status"] = "analyzing"
            job["message"] = "starting analysis"
            claim_ok = True
    if not claim_ok:
        return jsonify({"error": f'corners accepted only in "corners_needed" '
                                 f'(job is "{status}")'}), 409

    # normalized -> pixels of the DOWNSCALED video (frame.jpg resolution).
    # No clamping: real court corners may sit outside the camera frame.
    px_corners = {key: [round(nx * job["videoW"], 2), round(ny * job["videoH"], 2)]
                  for key, (nx, ny) in norm.items()}

    corners_doc = {
        "referenceTimeSec": job["refTimeSec"],
        "corners": px_corners,
        "courtSize": {"width": COURT_W, "length": COURT_L},
    }
    with open(os.path.join(_job_dir(job_id), "corners.json"), "w") as f:
        json.dump(corners_doc, f, indent=2)

    threading.Thread(target=_analyze_worker, args=(job,), daemon=True).start()
    return jsonify({"ok": True})


@app.route("/jobs/<job_id>/analysis.json")
def job_analysis(job_id):
    job, _user, denied = _guard_job(job_id)
    if denied is not None:
        return denied
    path = os.path.join(_job_dir(job_id), "out", "analysis.json")
    if job["status"] != "done" or not os.path.exists(path):
        return jsonify({"error": f'analysis not ready (job is "{job["status"]}")'}), 409
    return send_file(path, mimetype="application/json")


if __name__ == "__main__":
    os.makedirs(JOBS_DIR, exist_ok=True)
    _load_existing_jobs()
    app.run(host="0.0.0.0", port=PORT, threaded=True)
