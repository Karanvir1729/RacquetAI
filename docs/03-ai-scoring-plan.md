# 03 — AI scoring plan

**Status:** build contract for the AI phase. Nothing in this document is implemented except the
score state machines and domain types (`src/features/scoring/`). The app today records and plays
back video; the Score tab honestly says scoring is in development.

**Sport order:** squash first — it is the beachhead market (clubs with a fixed camera behind the
glass, box leagues, coaching) and, conveniently, the sport where scoring is most inferable from
non-ball signals. Tennis second. Pickleball and badminton reuse the pipeline but start only after
tennis passes its eval.

**Budget assumption:** US$10,000 in Azure credits, treated as the entire cloud budget from first
GPU experiment through a year of pilot serving. Every phase below carries an allocation and a
kill criterion so the credit cannot silently evaporate into research.

All prices in this doc are approximate US-region pay-as-you-go list prices (checked ballpark,
mid-2026); an operator must re-verify against the Azure pricing calculator before committing, and
spot prices float. Treat every dollar figure as an estimate with error bars, not a quote.

---

## 1. What we are building, precisely

Input: a single fixed-camera video of an amateur squash match — the standard club setup is a
camera centred high behind the glass back wall (the PSA broadcast angle); the fallback is a phone
clamped to the balcony rail. Output: an ordered list of `ScoreEvent`s — *side X won the rally at
t=…s with confidence c*, plus *play stopped for an appeal at t=…s* — which the pure per-sport
state machine folds into the full game/match score, plus a tap-to-seek timeline in the app.

Explicit consequences of that definition:

- **The AI's only job is rally attribution and stoppage detection.** PAR-11 arithmetic, serve
  hand, box alternation, game and match boundaries are deterministic code (`squash.ts`, already
  written and unit-tested; `tennis.ts` likewise). The model never "predicts the score"; it
  predicts rally outcomes. Corrections re-fold the event list — no model in that loop.
- **The AI never rules on lets and strokes.** It detects the *stoppage* and bookmarks it as a
  `LetDecisionEvent`; the ruling (let / stroke / no-let) always comes from a human. Video review
  of interference calls is the single most valuable refereeing use case in squash — box-league
  players argue these nightly — and it is exactly the case where a model pretending to referee
  would destroy trust. We deliver the clip and the three buttons, not the verdict.
- **Human correction is a first-class feature, not a fallback.** At 90% per-rally accuracy an
  11-7 game (~18 rallies) still contains ~2 errors, and score errors compound. The product
  promise is *assisted* scoring: the AI drafts the timeline, low-confidence rallies (below
  `REVIEW_CONFIDENCE_THRESHOLD = 0.75`) are queued for a 5-second confirm/flip review, and the
  state machine re-folds instantly.
- **Squash's scoring rule is an attribution gift.** Under PAR the rally winner serves next, a
  retained serve must alternate boxes, and a handout gives the new server a box choice. Who
  stands in which service box at the next serve is big, slow, and unoccluded — far easier to
  read than a 40 mm ball. The state machine predicts the legal next server/box for either rally
  outcome, so the *observed* next serve confirms or refutes each attribution within one rally.
  Mis-attributions self-reveal instead of silently compounding. No such gift exists in tennis
  (service alternates by rule, giving only a parity check) — one more reason squash goes first.

### Honest accuracy expectations

Published results (TrackNet-family ball tracking, broadcast pose datasets) are on professional
broadcast footage. Our footage is amateur: lower mounts, glass reflections, kit that blends into
walls, players who crowd each other on 62 m² of court. Expect a material drop from any paper
number. Working assumptions to plan against, not promises:

| Metric | Fixed club camera, calibrated | Phone through the glass, uncalibrated |
| --- | --- | --- |
| Rally boundary detection (F1) | 0.85–0.93 | 0.65–0.8 |
| Rally attribution accuracy (raw) | 75–90% | 55–75% |
| After serve-consistency check + review of flagged rallies | 95%+ | 80–90% |
| Stoppage (let appeal) recall | 0.7–0.85 | 0.5–0.7 |
| Rallies needing human review | 10–25% | 30–50%+ |

The squash ball itself may be effectively untrackable in amateur 30 fps footage (black, 40 mm,
280 km/h off a pro racquet, motion-blurred to a smear). **v1 attribution therefore must not
depend on ball tracking** — it leans on serve inference, audio, and pose (§2). If measured
reality lands well below the left column after M1's iteration budget, the kill criteria fire
(§5) and the product repositions around manual tap-scoring + AI-cut rally review rather than
shipping a scorer that is wrong every other game.

---

## 2. Vision pipeline

Seven stages. 1–6 are learned or geometric; 7 is deterministic code that already exists.

### 2.1 Court fit & venue calibration

A squash court is a room with fixed, known geometry (9.75 × 6.4 m; tin at 0.48 m, service line
at 1.78 m, out line at 4.57 m on the front wall; short line, half-court line, and two 1.6 m
service boxes on the floor). Fit the visible lines → homographies for the floor plane and front
wall. The beachhead camera is *fixed*: calibrate once per court, store the result as a **venue
profile** (court id → homography + camera height + glass/plaster flags), and re-verify cheaply
per video (a few seconds of line detection) instead of re-fitting every match. No stable fit →
the match is flagged "camera view unusable" with actionable feedback, instead of garbage output.
Phone-on-balcony footage runs the same fit per video without a stored profile.

### 2.2 Player detection & pose tracking

Per sampled frame (~10 fps): detect persons, keep the two on court via the floor homography,
track identity, estimate pose. Squash-specific pain: both players share the same small space,
mutual occlusion is constant (not occasional, as across a tennis net), and club kit is often
dark against dark glass. Identity therefore needs more than IoU association: kit-colour
histograms per track, re-anchored at every serve (server stands in a known box — a free,
periodic identity ground truth). Model candidates, in order of preference: **RTMDet + RTMPose**
(Apache-2.0, strong speed/accuracy on T4-class GPUs), YOLOX + RTMPose as fallback. **Licensing
note:** Ultralytics YOLOv8-pose is AGPL-3.0 — avoid server-side unless we accept the
obligations; the Apache stack is the default.

### 2.3 Audio events (first-class in squash)

Squash audio is unusually informative and nearly free to compute: racquet impacts are sharp
broadband transients; the front wall thud is distinct; the **tin is a resonant metal strip that
clangs** — an audible, rally-deciding line call; a let appeal is speech after an abrupt play
stop. Onset detection + a small audio classifier (impact / tin / bounce / speech) over the full
match provides rally cadence, rally-end causes, and appeal candidates before any GPU vision
runs. Phones through glass get a degraded but usable version (the glass attenuates, the club
echo does not).

### 2.4 Ball tracking (supporting signal, not load-bearing)

TrackNet-family heatmap regressor (multi-frame input, so blur becomes signal) fine-tuned on our
own labelled squash footage, run **only inside candidate rally windows** and only where it earns
its cost. Output feeds shot segmentation and "where did the ball die" when visible. Design rule
carried from §1: every consumer of the ball track must degrade gracefully to pose+audio when the
track drops out, because on amateur footage it will, often. (In tennis this stage is promoted:
the ball is bigger, brighter, and against sky/court — attribution there leans on it.)

### 2.5 Rally segmentation

Two-pass gating, and the main cost lever:

- **Cheap pass (CPU, full match):** audio cadence (2.3) + motion energy + player positions →
  candidate rally windows. Squash is denser than tennis — roughly 30–40% of elapsed time is
  ball-in-play at club level vs ~10–20% for tennis — so gating discards ~55–65% of footage,
  not ~80%. The cost model (§4) uses the squash number.
- **Heavy pass (GPU, windows only):** pose + optional ball track within each window → serve
  detection (a player set in a service box, characteristic toss/strike pose, after silence),
  shot cadence, rally end (impact cadence stops: winner walks to a box, loser fetches the ball,
  or speech = appeal).

### 2.6 Rally attribution & stoppage detection

Given a rally's end state, decide who won — or that nobody did (appeal). Signals in priority
order:

1. **Next-serve inference:** who serves the next rally, from which box (2.2's box occupancy).
   The state machine's prediction makes this self-verifying (§1). Resolves the previous rally
   with high confidence and catches upstream misses (an impossible server/box sequence means a
   rally was dropped — flag the gap for review).
2. **Audio end-cause:** tin clang = striker lost the rally; clean double-bounce silence after a
   far-court shot favours the striker. (The tin is squash's most decidable "line call".)
3. **Pose end-state:** loser retrieves the ball, winner takes position; works even when the
   ball was never tracked.
4. **Ball-death location** via homography, when the track survives to rally end.

Start as hand-written rules over these features — transparent, debuggable, each rally's
confidence set by its weakest contributing link. A learned classifier over the same features is
a later refinement, not the starting point. Separately, a rally window that ends in speech +
mutual stop with no decisive impact becomes a `LetDecisionEvent` bookmark (appealer guessed from
pose, ruling left `"let"`-pending for the human). Missed-appeal recall matters more than
precision here — a spurious bookmark costs a swipe, a missed one costs the whole argument the
feature exists to settle.

### 2.7 Score state machines (exist)

`src/features/scoring/squash.ts`: pure PAR-11 reducer — point-a-rally to 11, win by 2, best of
5; serve hand and box (retained serve alternates, handout opens a choice); let/stroke/no-let
folding; events after match end are no-ops; corrections = edit the event list and re-fold. Its
server/box prediction doubles as the pipeline's consistency oracle (2.6). `tennis.ts`: the same
shape for tennis (love/15/30/40/deuce/AD, games, sets, tiebreak, best-of-N). Both sit behind the
one `ScoreEngine` interface (`engine.ts`); pickleball/badminton add engines later without
touching callers. Queued extensions: conduct penalties (conduct stroke/game), injury stoppages,
no-ad tennis scoring, match tiebreaks.

### 2.8 Human-correction UX

Review queue sorted by confidence ascending: each item is a ~8-second clip around the rally end
with two big buttons (A won / B won) plus "not a rally" (false segment) — and, for stoppage
bookmarks, the referee's three: **let / stroke / no-let**. Every correction is a `ScoreEvent`
with `source: "human"`, `confidence: 1`, and a `corrects` pointer — an audit trail, not a
destructive edit. Target interaction cost: under 5 seconds per correction, under a minute per
match on clean footage. Corrected events are the fine-tuning data flywheel (with explicit user
consent per §6 privacy).

---

## 3. Azure architecture

Four phases. A is a workbench, B is the product service, C is garnish, D is the end-state.

### Phase A — research workbench (M0–M1)

- **Azure ML workspace** + a **spot-priority compute cluster** of `Standard_NC4as_T4_v3`
  (1× T4 16 GB — ample for every inference model here), min nodes 0, max 2. Jobs are
  checkpointed so spot eviction is a resume, not a loss.
- Fine-tuning experiments (TrackNet on our labels, audio classifier) on a single
  `Standard_NC24ads_A100_v4` (1× A100 80 GB) **spot** node, used in bursts.
- Footage + labels in **Blob Storage** (hot tier while active); CVAT or Label Studio on a
  burstable B-series CPU VM for annotation.
- Eval harness runs as AML jobs writing metrics to MLflow (built into AML) so every model change
  has a scoreboard.

### Phase B — batch scoring service (M3)

```
app ──(1) HTTPS──> Azure Function: "create job"
                     └─ issues short-lived, single-blob, write-only SAS
app ──(2) upload video──> Blob Storage (container: uploads/)
Blob-created ──> Event Grid ──(3)──> Storage Queue: score-jobs
Queue ──(4) triggers──> Azure Function: enqueue AML batch job / poke pipeline
AML batch endpoint (managed cluster, NC4as_T4_v3 spot, min 0 / max N)
  stages: probe+audio gate ─ court fit (venue profile) ─ pose ─ rally seg ─ ball (windows)
          ─ attribution+stoppages ─ assemble events
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
- **Venue profiles:** a tiny keyed store (Cosmos) of per-court calibration (2.1) — the thing
  that makes club fixed cameras cheap and reliable. Club onboarding = record 30 s of empty
  court, run the fit once.
- **Model registry:** AML registry, versioned; a model version is promoted to the batch endpoint
  only after the eval harness beats the incumbent on the frozen eval set. Rollback = repoint.
- **Video retention:** uploads auto-delete via lifecycle policy after results are confirmed
  (default 7 days), unless the user opts in to contribute footage for training.

### Phase C — summaries & highlights (post-M3, optional)

Azure AI Foundry / Azure OpenAI: feed the *structured* match data (score flow, rally lengths,
streaks, decision log — never raw video) to a small model (`gpt-4o-mini`-class) for a match
recap; cut highlight reels mechanically from the longest/decisive rallies already segmented; a
box-league night gets an automatic results sheet. Cost noise: well under $0.01/match. This is
deliberately last — it is garnish on top of correct scoring.

### Phase D — on-device real-time (M4, end-state)

`react-native-vision-camera` frame processors driving distilled CoreML models (ANE-targeted):
court fit at startup, pose + audio live, ball model gated or dropped, state machine on-device
(it already runs there — it's plain TypeScript). Live scoreboard during recording; cloud path
remains for after-the-fact scoring and as the accuracy reference. This inverts the cost curve
(user hardware, $0 marginal) and is why the domain model was designed device-first from day one.
Requires a dev build (frame processors are outside Expo Go) — fine, we ship dev-client builds
already.

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

Assumptions: 1080p30 input; audio pass ≈ CPU-free; pose sampled at 10 fps across the match; ball
model at 20–30 fps inside rally windows only; squash rally windows ≈ 35% of elapsed time (denser
than tennis — gating saves less here, see 2.5); decode dominated by CPU (hence NC8as option).

| Pipeline maturity | GPU-hours per match-hour | On-demand $/mh | Spot $/mh |
| --- | --- | --- | --- |
| Naive (all models, all frames) | ~3–4 T4-hr | $1.60–2.10 | $0.40–0.65 |
| Gated two-pass (M1 target) | ~1.0–1.5 T4-hr | $0.53–0.80 | $0.12–0.24 |
| Optimized (TensorRT, batching, ball demoted; M3 target) | ~0.4–0.7 T4-hr | $0.21–0.37 | $0.05–0.11 |

Storage: a 1080p30 HEVC match-hour ≈ 2–4 GB → $0.04–0.08/mo hot, near-zero after the 7-day
lifecycle delete. Functions/Queue/Cosmos at pilot volume: single-digit dollars/month.

### Monthly burn scenarios

| Scenario | Compute profile | ~Monthly burn |
| --- | --- | --- |
| Dev iteration month (M1) | 150 T4-spot-hr eval/dev + 60 A100-spot-hr tuning | $90–120 + $70–100 ≈ **$160–220** |
| Heavy training month | 150 A100-spot-hr + 200 T4-spot-hr | **$400–550** |
| Pilot serving (200 match-hr/mo, spot, optimized) | ~120 T4-spot-hr + infra | **$35–90** |
| Pilot serving, on-demand fallback | same on-demand | **$100–200** |

For scale: two pilot clubs' box leagues ≈ 30 matches/week ≈ 100 match-hours/month — inside the
cheapest row. Squash's shorter matches (30–50 min vs tennis's 1.5–2.5 h) also mean more matches
per credit dollar.

### How far does $10,000 go?

| Allocation | Amount |
| --- | --- |
| M0 — squash data, annotation infra, eval harness | $300 |
| M1 — offline squash pipeline + fine-tuning iterations | $2,500 |
| M2 — assisted-scoring + let/stroke review loop (mostly app work; continued eval) | $1,200 |
| M3 — service build-out, load tests, club pilot cohort | $2,000 |
| Tennis onboarding (second sport: data, eval, rally heuristics) | $1,000 |
| M4 — distillation/export experiments for CoreML | $1,000 |
| Reserve (20%) | $2,000 |

Bottom line: the credit comfortably covers the entire R&D arc **plus roughly a year of pilot
serving at hundreds of match-hours/month**. The budget risk is not serving cost — it is
open-ended model iteration in M1. That is what the kill criteria are for. GPU quota is a
practical gate: new subscriptions start with 0 NC/A100 quota, so quota requests are an M0 task.

---

## 5. Milestones

### M0 — Ground truth & eval harness (2–3 weeks, $300)

Collect ≥30 amateur squash recordings across court types (plaster, glass-back, all-glass show
court) and camera setups (fixed club mount, phone on balcony); annotate ≥12 matches fully:
rally boundaries, rally winner, server + box per rally, every stoppage/appeal with its actual
ruling (~1,500–2,500 labelled rallies); stand up annotation tooling; build the eval harness
(rally F1, attribution accuracy, serve-consistency catch rate, stoppage recall, end-score
exactness, review-rate) running as an AML job; file GPU quota requests; calibrate venue
profiles for 2 friendly courts. **Acceptance:** frozen eval set + harness produces a scoreboard
for a trivial baseline. **Kill:** none — this de-risks everything and is cheap.

### M1 — Offline squash pipeline works (6–8 weeks, $2,500)

Stages 2.1–2.6 runnable as one AML job on a recorded match. **Acceptance, on the fixed-camera
eval split:** court fit stable on ≥95% of matches with a venue profile; rally F1 ≥ 0.85; raw
rally attribution ≥ 75% with the serve-consistency check flagging ≥ 80% of its own errors;
stoppage recall ≥ 0.7; end-to-end game score exactly right after ≤ 3 corrections/game.
**Kill:** attribution < 60% on fixed-camera footage after the $2.5k iteration budget → stop;
pivot the product to manual tap-scoring with AI rally segmentation for video review (stages
2.1–2.5 still pay for themselves — a box-league night with jump-to-any-rally video is a product
even with zero attribution).

### M2 — Assisted scoring + referee loop (3–4 weeks, $1,200)

Events flow into the app; state machine + timeline UI + correction queue (2.8) including the
let/stroke/no-let review flow; serve-consistency surfaced as "check this rally" flags.
**Acceptance:** a real match goes footage → reviewed → confirmed final score in < 10 min of
user effort; median ≤ 1 correction per 10 rallies on fixed-camera footage; a disputed let can
be found, watched, and ruled in < 30 s from opening the match. **Kill:** if > 40% of rallies
need review on fixed-camera footage, the AI isn't assisting — hold the product at manual
scoring + rally-segmented video until models improve.

### M3 — Cloud service in production shape + club pilot (4–6 weeks, $2,000)

Phase B architecture live: SAS upload, queue, batch endpoint (spot, scale-to-zero), results
API, venue-profile store, model registry with eval-gated promotion, retention lifecycle. Pilot
at 2 squash clubs with fixed cameras (box-league nights). **Acceptance:** p95 turnaround ≤ 1×
match duration at pilot load; marginal cost ≤ $0.50/match-hour on-demand and ≤ $0.15 spot; a
month of idle costs < $10; 50 external pilot matches scored. **Kill:** if real cost floors
above ~$1/match-hour, cloud scoring is not a viable free feature — gate it behind a paid tier
or jump directly to M4 on-device. **Parallel start:** tennis M0/M1 on the same harness and
budget line (court fit outdoors, ball promoted to primary signal, serve-side parity check
replacing squash's serve gift).

### M4 — On-device real-time (8–12 weeks, $1,000 + reserve as needed)

Distill/quantise pose (+ audio classifier; ball only if it earned its place) to CoreML (ANE),
vision-camera frame processors, live scoreboard. **Acceptance:** ≥ 15 fps combined pipeline on
iPhone 13-class hardware; 45 minutes sustained (a full squash match) without thermal throttling
below 10 fps; live score within 1 correction/10 rallies of the cloud pipeline on the same
footage. **Kill:** if sustained thermals cap below 10 fps on target hardware, ship "record now,
auto-score on end" on-device batch instead of live.

---

## 6. Risks & mitigations

| Risk | Why it bites | Mitigation |
| --- | --- | --- |
| Mutual occlusion | Both players share 62 m²; bodies cross constantly, unlike across a tennis net | Attribution leans on serve inference + audio, not continuous tracks; serve-box re-anchoring restores identity every rally |
| Ball invisibility | Black 40 mm ball, 30 fps amateur footage, dark floors — may be untrackable | Ball demoted to supporting signal by design (2.4); nothing load-bearing consumes it |
| Glass reflections | Back-wall glass mirrors players and crowd; show courts are all glass | Venue profile flags glass surfaces; train on glass-court footage from M0; reflection-aware person filtering (on-court via floor homography) |
| Court variance | Plaster vs glass, wood vs painted floors, sponsor logos on the front wall | Per-court-type eval splits from M0; venue calibration absorbs per-court geometry; don't certify a court type until it passes eval |
| Amateur footage quality | Low mounts, fluorescent flicker, phones propped on railings | Court-fit QC gate rejects unusable views early with actionable feedback ("raise the camera") |
| Score drift from one missed rally | PAR errors compound through games | Serve-consistency oracle catches impossible sequences within one rally; review queue; deterministic re-fold on correction |
| Let/stroke trust | Auto-ruling interference would be confidently wrong and poison the referee use case | Hard product rule: AI bookmarks, humans rule (§1); recall-biased stoppage detection |
| Spot eviction | Long jobs die mid-match | Per-stage checkpoints in Blob; resume, don't restart |
| Model licensing | Ultralytics AGPL server-side | Apache stack (RTMDet/RTMPose, YOLOX; per-repo TrackNet licence audit) — check every repo before M1 code lands |
| Battery/thermals (M4) | Sustained ANE+GPU load for a 45-min match | Distillation, frame-rate governor, batch-on-end fallback (M4 kill path) |
| Privacy | Footage contains other people, sometimes minors, on club premises | Consent copy at upload; club signage guidance in pilot kit; 7-day retention default; training use strictly opt-in; delete-on-request; no third-party sharing |
| Cost blow-up | Unbounded M1 iteration | Per-milestone budgets + kill criteria; AML cost alerts at 50/80% of phase budget |

---

## 7. Out of scope (for this plan)

- Multi-camera rigs or broadcast footage; umpire-grade line/down calling (we are explicitly not
  the PSA video-review booth, and the UX copy must never imply otherwise).
- Automatic let/stroke rulings — permanently out, not just deferred (§1).
- Doubles (hardball or squash 57) — sides are typed for it, but singles is the entire beachhead.
- Player skill analytics, shot-type classification, coaching feedback — natural sequels, all
  downstream of the same pipeline, none of them gating.
- Android real-time parity for M4 (NNAPI/GPU delegates differ; cloud path covers Android
  meanwhile).

## 8. Open questions (answer by end of M0)

1. Capture spec: is 1080p60 worth mandating on fixed installs? (Halves motion blur — may
   resurrect the ball track on club cameras; costs storage/upload.)
2. TrackNet variant + licence choice after the M0 repo audit — or skip ball entirely for v1?
3. Audio rights/practicalities: club cameras with no mic → how much attribution accuracy is
   lost, per the eval harness's audio-ablated run?
4. Anonymous-install job auth: rate limiting/abuse posture before any public pilot.
5. Whether pilot uploads ride Wi-Fi-only by default (a match-hour is 2–4 GB; club Wi-Fi is the
   norm for fixed cameras anyway).
