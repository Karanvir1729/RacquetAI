#!/bin/bash
# End-to-end smoke test for server.py against the pexels_squash sample.
#
#   analysis/.venv/bin/python analysis/server.py   # in another shell (port 8082)
#   bash analysis/test_server.sh
#
# Uploads samples/pexels_squash.mp4, polls, fetches frame.jpg, POSTs the known
# calibration corners (samples/pexels_squash.corners.json pixel coords for the
# ORIGINAL 3840x2160 video, normalized here to 0..1 so they are resolution-
# independent), waits for "done" and validates analysis.json.
set -euo pipefail
BASE="${BASE:-http://localhost:8082}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$DIR/.venv/bin/python"

echo "== POST /jobs (upload sample)"
JOB=$(curl -sf -F "video=@$DIR/samples/pexels_squash.mp4" "$BASE/jobs" | "$PY" -c \
  "import json,sys; print(json.load(sys.stdin)['jobId'])")
echo "jobId=$JOB"

echo "== poll until corners_needed"
for i in $(seq 1 120); do
  S=$(curl -sf "$BASE/jobs/$JOB")
  ST=$("$PY" -c "import json,sys; print(json.loads(sys.argv[1])['status'])" "$S")
  echo "  [$i] $S"
  [ "$ST" = "corners_needed" ] && break
  [ "$ST" = "error" ] && { echo "FAIL: job errored during prepare"; exit 1; }
  sleep 2
done
[ "$ST" = "corners_needed" ] || { echo "FAIL: never reached corners_needed"; exit 1; }

echo "== GET frame.jpg"
curl -sf "$BASE/jobs/$JOB/frame.jpg" -o /tmp/racquet_frame_$JOB.jpg
file /tmp/racquet_frame_$JOB.jpg

echo "== POST corners (normalized from the original 3840x2160 calibration)"
BODY=$("$PY" - "$DIR/samples/pexels_squash.corners.json" <<'EOF'
import json, sys
# Known calibration was fit on the ORIGINAL 3840x2160 pexels video; normalize
# by those dimensions. backLeft/backRight fall outside 0..1 on purpose — the
# court's back corners sit outside the camera frame.
W, H = 3840.0, 2160.0
c = json.load(open(sys.argv[1]))["corners"]
print(json.dumps({k: [round(v[0] / W, 6), round(v[1] / H, 6)] for k, v in c.items()}))
EOF
)
echo "  body: $BODY"
curl -sf -X POST -H "Content-Type: application/json" -d "$BODY" "$BASE/jobs/$JOB/corners"
echo

echo "== poll until done"
for i in $(seq 1 300); do
  S=$(curl -sf "$BASE/jobs/$JOB")
  ST=$("$PY" -c "import json,sys; print(json.loads(sys.argv[1])['status'])" "$S")
  echo "  [$i] $S"
  [ "$ST" = "done" ] && break
  [ "$ST" = "error" ] && { echo "FAIL: analysis errored"; exit 1; }
  sleep 5
done
[ "$ST" = "done" ] || { echo "FAIL: never reached done"; exit 1; }

echo "== GET analysis.json + validate"
curl -sf "$BASE/jobs/$JOB/analysis.json" -o /tmp/racquet_analysis_$JOB.json
"$PY" - /tmp/racquet_analysis_$JOB.json <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["schemaVersion"] in (1, 2), f'schemaVersion {d["schemaVersion"]}'
ids = [p["id"] for p in d["players"]]
assert ids == ["A", "B"], f"players {ids}"
for p in d["players"]:
    assert set(p["placement"]) == {"frontLeft", "frontRight", "backLeft", "backRight"}
    assert len(p["coverageHeatmap"]["values"]) == p["coverageHeatmap"]["rows"] * p["coverageHeatmap"]["cols"]
assert isinstance(d["shots"], list) and len(d["shots"]) > 0, "no shots placed"
print("OK: players", ids, "| shots:", len(d["shots"]),
      "| rallies:", d["rallies"]["count"],
      "| bothPlayersDetectedPct:", d["quality"]["bothPlayersDetectedPct"])
EOF
"$DIR/tools/validate_contract.py" /tmp/racquet_analysis_$JOB.json 2>/dev/null \
  || "$PY" "$DIR/tools/validate_contract.py" /tmp/racquet_analysis_$JOB.json || true
echo "E2E PASS (job $JOB)"
