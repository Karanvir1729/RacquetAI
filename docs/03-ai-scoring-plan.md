# 03 — AI scoring plan

**Status:** build contract for the AI phase. Nothing in this document is implemented except the
score state machine and domain types (`src/features/scoring/`). The app today records and plays
back video; the Score tab honestly says scoring is in development.

**Budget assumption:** US$10,000 in Azure credits, treated as the entire cloud budget from first
GPU experiment through a year of pilot serving. Every phase below carries an allocation and a
kill criterion so the credit cannot silently evaporate into research.

All prices in this doc are approximate US-region pay-as-you-go list prices (checked ballpark,
mid-2026); an operator must re-verify against the Azure pricing calculator before committing, and
spot prices float. Treat every dollar figure as an estimate with error bars, not a quote.

---

## 1. What we are building, precisely

Input: a single fixed-camera video of an amateur match, filmed on a phone (tripod or fence mount,
roughly behind and above one baseline — the position the Record tab will coach users into).
Output: an ordered list of `ScoreEvent`s — *side X won a point at t=…s with confidence c* — which
the pure per-sport state machine folds into the full game/set/match score, plus a
tap-to-seek timeline in the app.

Explicit consequences of that definition:

- **The AI's only job is point attribution.** Games, sets, deuce, tiebreaks are deterministic
  code (`tennis.ts`, already written and unit-tested). The model never "predicts the score";
  it predicts rally outcomes. Corrections re-fold the event list — no model in that loop.
- **Human correction is a first-class feature, not a fallback.** At 95% per-point accuracy a
  6-4 set (~60 points) still contains ~3 errors, and score errors compound — one wrong point
  can flip every subsequent game boundary. The product promise is *assisted* scoring: the AI
  drafts the timeline, low-confidence points (below `REVIEW_CONFIDENCE_THRESHOLD = 0.75`) are
  queued for a 5-second confirm/flip review, and the state machine replays instantly.
- **Tennis first.** Pickleball and badminton reuse the pipeline stages but need their own rally
  heuristics and reducers; they start only after tennis M2 passes.

### Honest accuracy expectations

Published results (TrackNet-family ball tracking, broadcast pose datasets) are on professional
broadcast footage: high vantage, stable exposure, pro players, known courts. Our footage is
amateur: lower camera angles, fences and shadows, mis-hit balls with weird trajectories, players
who wander. Expect a material accuracy drop from any paper number. Working assumptions:

| Metric | Clean tripod footage | Messy footage (hand-held, low sun) |
| --- | --- | --- |
| Rally boundary detection (F1) | 0.85–0.92 | 0.6–0.8 |
| Point attribution accuracy | 75–90% | 50–75% |
| Points needing human review | 10–25% | 30–50%+ |

If measured reality lands well below the left column after M1's iteration budget, the kill
criteria fire (§6) and the product repositions around manual tap-scoring + AI-cut highlights
rather than shipping a scorer that is wrong every other game.

---

## 2. Vision pipeline

Six stages. 1–5 are learned or geometric; 6 is deterministic code that already exists.

### 2.1 Court detection & homography

Find the court lines and fit a homography mapping image coordinates → court plane. Standard
approach: line segment detection + model fitting against the known court geometry (tennis court
dimensions are fixed; pickleball and badminton likewise), optionally seeded by a small
segmentation net for line pixels on low-contrast courts. Computed once per N seconds (camera is
nominally fixed; re-fit drifts from wind/bumps). Everything downstream (ball bounce position,
player side assignment, in/out priors) hangs off this, so it runs first and gates the rest: no
stable homography → the match is flagged "camera view unusable" instead of producing garbage.

### 2.2 Player detection & pose tracking

Per sampled frame (~10 fps): detect persons, keep the 2–4 on-court via the homography, track
identities across frames (ByteTrack-style association is enough for two players who stay on
opposite sides), and estimate pose keypoints for swing/contact cues. Model candidates, in order
of preference: **RTMDet + RTMPose** (Apache-2.0, strong speed/accuracy on T4-class GPUs),
YOLOX + RTMPose as fallback. **Note on licensing:** Ultralytics YOLOv8-pose is AGPL-3.0 —
avoid it server-side unless we accept the obligations; the Apache-licensed stack is the default.

### 2.3 Ball tracking

The hard one. Small, fast, motion-blurred object; occluded by players; leaves frame. Approach:
TrackNet-family heatmap regressor (multi-frame input, so blur becomes signal) fine-tuned on our
own labelled footage, run at ~15–30 fps **only inside candidate rally windows** (see 2.4 —
running it on dead time between points would triple cost for nothing). Output: per-frame ball
position + a trajectory smoother (physics-informed spline / Kalman) that bridges short occlusions
and yields bounce events (sharp vertical velocity inversion near the court plane).

### 2.4 Shot & rally segmentation

Two-pass gating, and the main cost lever:

- **Cheap pass (CPU or tiny GPU model, full match):** motion energy + player-position priors +
  audio onset detection (racquet impacts are sharp broadband transients — audio is nearly free
  and surprisingly discriminative) → candidate rally windows. Amateur tennis is ~10–20%
  ball-in-play, so this pass discards ~80% of the footage before any heavy model runs.
- **Heavy pass (GPU, windows only):** ball track + pose within each window → shot events
  (contacts), rally start (serve motion + ball toss is a distinctive pose signature), rally end
  (ball goes dead: double bounce, net, out-of-frame + no return motion).

### 2.5 Point attribution

Given a rally's shot sequence, ball track, and end state, decide who won: last-contact side +
where the ball died (bounce inside/outside lines via homography, net cord, no return). Start as
hand-written rules over the extracted features — transparent, debuggable, and each rally carries
a confidence from its weakest link (ball-track coverage %, bounce localisation margin, line
proximity). A learned classifier over the same features is a later refinement, not the starting
point. Line calls within ~15 cm of a line are inherently low-confidence from amateur camera
angles: mark them for review rather than pretending.

### 2.6 Score state machine (exists)

`src/features/scoring/tennis.ts`: pure reducer, love/15/30/40/deuce/advantage, games, sets,
tiebreak at 6-6, best-of-N; events after match point are no-ops; corrections = edit the event
list and re-fold. Extensions queued behind M2: serve tracking (which also gives the pipeline a
serve-order sanity check to detect missed points — if the observed server contradicts the
computed game count, a point was probably dropped), no-ad scoring, match tiebreaks, and the
pickleball (side-out) and badminton (rally-to-21) reducers whose state shapes are already typed.

### 2.7 Human-correction UX

Review queue sorted by confidence ascending: each item is a ~6-second clip around the rally end
with two big buttons (A won / B won) plus "not a point" (false rally). Every correction is a
`ScoreEvent` with `source: "human"`, `confidence: 1`, and a `corrects` pointer — an audit trail,
not a destructive edit. Target interaction cost: under 5 seconds per correction, under a minute
per match on clean footage. Corrected events are the fine-tuning data flywheel (with explicit
user consent per §7 privacy).

---

## 3. Azure architecture

Four phases. A is a workbench, B is the product service, C is garnish, D is the end-state.

### Phase A — research workbench (M0–M1)

- **Azure ML workspace** + a **spot-priority compute cluster** of `Standard_NC4as_T4_v3`
  (1× T4 16 GB — ample for every inference model here), min nodes 0, max 2. Jobs are
  checkpointed so spot eviction is a resume, not a loss.
- Fine-tuning experiments (TrackNet on our labels) on a single `Standard_NC24ads_A100_v4`
  (1× A100 80 GB) **spot** node, used in bursts.
- Footage + labels in **Blob Storage** (hot tier while active); CVAT or Label Studio on a
  burstable B-series CPU VM for annotation.
- Eval harness runs as AML jobs writing metrics to MLflow (built into AML) so every model/prompt
  change has a scoreboard.

### Phase B — batch scoring service (M3)

```
app ──(1) HTTPS──> Azure Function: "create job"
                     └─ issues short-lived, single-blob, write-only SAS
app ──(2) upload video──> Blob Storage (container: uploads/)
Blob-created ──> Event Grid ──(3)──> Storage Queue: score-jobs
Queue ──(4) triggers──> Azure Function: enqueue AML batch job / poke pipeline
AML batch endpoint (managed cluster, NC4as_T4_v3 spot, min 0 / max N)
  stages: probe+audio gate ─ court fit ─ pose ─ ball ─ rally ─ attribution ─ assemble events
        ──(5) results JSON (ScoreEvent[] + per-stage QC)──> Blob (results/) + Cosmos DB
             (serverless) job-status row
app ──(6) polls GET /jobs/{id} (Function) ──> status | events payload ──> state machine on-device
```

Design points:

- **Scale-to-zero everywhere.** AML batch cluster min nodes 0, Functions consumption plan,
  Cosmos serverless. Idle cost is storage only — a dormant month costs dollars, not hundreds.
- **SAS-scoped uploads:** the app never holds account keys; the Function issues a write-only SAS
  for exactly one blob path, expiring in minutes. No user accounts exist in v0, so jobs key off
  a per-install anonymous id; auth hardens when accounts land.
- **Model registry:** AML registry, versioned; a model version is promoted to the batch endpoint
  only after the eval harness beats the incumbent on the frozen eval set. Rollback = repoint.
- **Video retention:** uploads auto-delete via lifecycle policy after results are confirmed
  (default 7 days), unless the user opts in to contribute footage for training.

### Phase C — summaries & highlights (post-M3, optional)

Azure AI Foundry / Azure OpenAI: feed the *structured* match data (score flow, rally lengths,
streaks — never raw video) to a small model (`gpt-4o-mini`-class) for a match recap, and cut
highlight reels mechanically from the longest/decisive rallies already segmented. Cost noise:
well under $0.01/match. This is deliberately last — it is garnish on top of correct scoring.

### Phase D — on-device real-time (M4, end-state)

`react-native-vision-camera` frame processors driving distilled CoreML models (ANE-targeted):
court fit at startup, pose + gated ball model live, state machine on-device (it already runs
there — it's plain TypeScript). Live scoreboard during recording; cloud path remains for
after-the-fact scoring and as the accuracy reference. This inverts the cost curve (user hardware,
$0 marginal) and is why the domain model was designed device-first from day one. Requires a dev
build (frame processors are outside Expo Go) — fine, we ship dev-client builds already.

---

## 4. Cost model

### GPU SKU reference (approx. US regions, mid-2026; re-verify before committing)

| SKU | GPU | ~On-demand | ~Spot | Role |
| --- | --- | --- | --- | --- |
| `Standard_NC4as_T4_v3` | 1× T4 16 GB | $0.53/hr | $0.10–0.16/hr | All batch inference |
| `Standard_NC8as_T4_v3` | 1× T4, more CPU | $0.75/hr | $0.15–0.23/hr | Decode-bound stages |
| `Standard_NV6ads_A10_v5` | 1/6× A10 | $0.45/hr | n/a (partial) | Alt. inference bench |
| `Standard_NC24ads_A100_v4` | 1× A100 80 GB | $3.70/hr | $1.10–1.60/hr | Fine-tuning only |

### $/match-hour of inference

Assumptions: 1080p30 input; pose sampled at 10 fps; ball model at 20 fps inside rally windows
only; rallies ≈ 15% of elapsed time; decode dominated by CPU (hence NC8as option).

| Pipeline maturity | GPU-hours per match-hour | On-demand $/mh | Spot $/mh |
| --- | --- | --- | --- |
| Naive (all models, all frames) | ~3–4 T4-hr | $1.60–2.10 | $0.40–0.65 |
| Gated two-pass (M1 target) | ~0.8–1.2 T4-hr | $0.42–0.64 | $0.10–0.19 |
| Optimized (TensorRT, batching, M3 target) | ~0.3–0.6 T4-hr | $0.16–0.32 | $0.04–0.10 |

Storage: a 1080p30 HEVC match-hour ≈ 2–4 GB → $0.04–0.08/mo hot, near-zero after the 7-day
lifecycle delete. Functions/Queue/Cosmos at pilot volume: single-digit dollars/month.

### Monthly burn scenarios

| Scenario | Compute profile | ~Monthly burn |
| --- | --- | --- |
| Dev iteration month (M1) | 150 T4-spot-hr eval/dev + 60 A100-spot-hr tuning | $90–120 + $70–100 ≈ **$160–220** |
| Heavy training month | 150 A100-spot-hr + 200 T4-spot-hr | **$400–550** |
| Pilot serving (200 match-hr/mo, spot, optimized) | ~100 T4-spot-hr + infra | **$30–80** |
| Pilot serving, on-demand fallback | same on-demand | **$90–180** |

### How far does $10,000 go?

| Allocation | Amount |
| --- | --- |
| M0 — data, annotation infra, harness | $300 |
| M1 — offline pipeline + fine-tuning iterations | $2,500 |
| M2 — assisted-scoring loop (mostly app work; continued eval) | $1,200 |
| M3 — service build-out, load tests, pilot cohort | $2,000 |
| M4 — distillation/export experiments for CoreML | $1,000 |
| Reserve (~30%) | $3,000 |

Bottom line: the credit comfortably covers the entire R&D arc **plus roughly a year of pilot
serving at hundreds of match-hours/month**. The budget risk is not serving cost — it is
open-ended model iteration in M1. That is what the kill criteria are for. GPU quota is a
practical gate: new subscriptions start with 0 NC/A100 quota, so quota requests are an M0 task.

---

## 5. Milestones

### M0 — Ground truth & eval harness (2–3 weeks, $300)

Collect ≥30 amateur match recordings across court types/lighting (own footage + consented pilot
users); annotate ≥10 tennis matches fully: rally boundaries, point winner, serve side
(~800–1,500 labelled points); stand up annotation tooling; build the eval harness (rally F1,
attribution accuracy, end-score exactness, review-rate) running as an AML job; file GPU quota
requests. **Acceptance:** frozen eval set + harness produces a scoreboard for a trivial baseline.
**Kill:** none — this de-risks everything and is cheap.

### M1 — Offline pipeline works (6–8 weeks, $2,500)

Stages 2.1–2.5 runnable as one AML job on a recorded match. **Acceptance, on the clean-footage
eval split:** homography stable on ≥95% of tripod matches; rally F1 ≥ 0.85; point attribution
≥ 75%; end-to-end set score exactly right after ≤3 corrections/set. **Kill:** attribution < 60%
on clean footage after the $2.5k iteration budget → stop; pivot the product to manual tap-scoring
with AI rally-detection for highlights (stages 2.1–2.4 still pay for themselves).

### M2 — Assisted scoring loop (3–4 weeks, $1,200)

Events flow into the app; state machine + timeline UI + correction queue (2.7); serve-order
sanity check in the reducer. **Acceptance:** a real match goes footage → reviewed → confirmed
final score in < 10 min of user effort; median ≤ 1 correction per 10 points on clean footage.
**Kill:** if > 40% of points need review on clean footage, the AI isn't assisting — hold the
product at manual scoring + video timeline until models improve.

### M3 — Cloud service in production shape (4–6 weeks, $2,000)

Phase B architecture live: SAS upload, queue, batch endpoint (spot, scale-to-zero), results API,
model registry with eval-gated promotion, retention lifecycle. **Acceptance:** p95 turnaround
≤ 1× match duration at pilot load; marginal cost ≤ $0.50/match-hour on-demand and ≤ $0.15 spot;
a month of idle costs < $10; 50 external pilot matches scored. **Kill:** if real cost floors
above ~$1/match-hour, cloud scoring is not a viable free feature — gate it behind paid tier or
jump directly to M4 on-device.

### M4 — On-device real-time (8–12 weeks, $1,000 + reserve as needed)

Distill/quantise pose + ball models to CoreML (ANE), vision-camera frame processors, live
scoreboard. **Acceptance:** ≥ 15 fps combined pipeline on iPhone 13-class hardware; 20 minutes
sustained without thermal throttling below 10 fps; live score within 1 correction/10 points of
the cloud pipeline on the same footage. **Kill:** if sustained thermals cap below 10 fps on
target hardware, ship "record now, auto-score on end" on-device batch instead of live.

---

## 6. Risks & mitigations

| Risk | Why it bites | Mitigation |
| --- | --- | --- |
| Occlusion (single camera) | Players block ball/bounce at the far court | Physics-informed trajectory bridging; confidence drops instead of guesses; coached camera height |
| Amateur footage quality | Shake, low sun, fences, sprinklers, wandering dogs | Homography QC gate rejects unusable views early with actionable feedback ("raise the camera") |
| Court-type variance | Clay skid marks, faded lines, multi-line pickleball courts, indoor badminton glare | Per-surface eval splits from M0; line-segmentation fallback; don't certify a surface until it passes eval |
| Ball speed (badminton) | Smashes 300+ km/h — worst-case for 30 fps footage | Badminton last; require 60 fps capture for it (Record tab can default per sport) |
| Score drift from one missed point | Errors compound through games/sets | Serve-order sanity check; review queue; deterministic re-fold on correction |
| Spot eviction | Long jobs die mid-match | Per-stage checkpoints in Blob; resume, don't restart |
| Model licensing | Ultralytics AGPL server-side | Apache stack (RTMDet/RTMPose, YOLOX, TrackNet-per-repo licence audit) — check every repo before M1 code lands |
| Battery/thermals (M4) | Sustained ANE+GPU load in the sun | Distillation, frame-rate governor, batch-on-end fallback (M4 kill path) |
| Privacy | Footage contains other people, sometimes minors | Consent copy at upload; 7-day retention default; training use strictly opt-in; delete-on-request; no third-party sharing |
| Cost blow-up | Unbounded M1 iteration | Per-milestone budgets + kill criteria; AML cost alerts at 50/80% of phase budget |

---

## 7. Out of scope (for this plan)

- Multi-camera or broadcast footage; umpire-grade line calling (we are explicitly not Hawk-Eye,
  and the UX copy must never imply otherwise).
- Doubles identity attribution beyond side-level scoring (sides are enough for the score).
- Player skill analytics, shot-type classification, coaching feedback — natural sequels, all
  downstream of the same pipeline, none of them gating.
- Android real-time parity for M4 (NNAPI/GPU delegates differ; cloud path covers Android
  meanwhile).

## 8. Open questions (answer by end of M0)

1. Capture spec: do we require 1080p60 for tennis too? (Costs storage/upload; halves ball-blur.)
2. TrackNet variant + licence choice after the M0 repo audit.
3. Anonymous-install job auth: rate limiting/abuse posture before any public pilot.
4. Whether pilot uploads ride Wi-Fi-only by default (a match-hour is 2–4 GB).
