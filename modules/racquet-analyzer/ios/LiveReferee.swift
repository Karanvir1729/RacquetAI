// LiveReferee.swift — the live rally state machine: pose frames and audio
// onsets in, "a rally started / somebody struck the ball / the rally has
// probably ended and probably this player won it" out.
//
// Deliberately free of AVFoundation and of the Expo bridge. Everything here is
// plain values over bounded buffers, so it can be reasoned about, parsed
// standalone, and driven from a test harness without a camera.
//
// ---------------------------------------------------------------------------
// WHAT THIS CANNOT DO, stated before what it can
// ---------------------------------------------------------------------------
// There is no ball tracking in this project. A squash rally ends for reasons
// that are entirely about the ball — two bounces, the tin, out of court, or a
// retrieval that failed — and none of those are visible to a pose model. So
// this engine cannot decide a point. It can only notice that the shot stream
// went quiet and say who hit last.
//
// The heuristic behind the proposal, "the last player to strike the ball won
// the rally", was measured on hand-labelled footage (Phase 1, 2026-08-18,
// archive_match2/3/4): right on 8 of 11 labellable rallies, 72.7%, Wilson 95%
// CI [43.4%, 90.3%]. That is an ORACLE score — the TRUE last striker read off
// the frames by hand against the TRUE winner. This engine has to find the
// rally end and the striker for itself, and the same labelling session found
// that both of those are unreliable:
//
//   - 1 of the 15 inspected breaks in the shot stream was not a rally end at
//     all (archive_match2 t=94.4, a 5.2 s gap with the players moving at rally
//     pace straight through it: missed shots, not a break);
//   - the detector's last shot is frequently NOT the rally end — at t=237.05
//     the rally had ended ~4 s earlier, at t=152.97 ~1.7 s earlier — so the
//     striker it names can be the wrong person doing the wrong thing (a bounce
//     or a ball pickup after the point is over);
//   - "audio goes quiet between rallies" is false in this venue: the 10.9 s
//     break at t=102.6 contains thirteen ungated onsets, about one per 0.8 s;
//   - a smoothed player-speed threshold does not separate rally movement from
//     jogging back to the service box;
//   - 3 of 14 real rally ends could not be labelled by a careful human at all
//     (occlusion through the glass, camera pans, both players swinging inside
//     the same second).
//
// So 0.727 is a CEILING that the live path cannot reach, and every confidence
// factor below multiplies it DOWNWARDS. The output is a prompt for a human,
// never a verdict. Nothing in this file should ever be described in a way that
// implies otherwise.

import Foundation

// MARK: - Tuning

/// Every threshold the live rally rule depends on, in one place, settable from
/// JS at session start.
///
/// This is a config object rather than a set of constants because the rule is
/// venue-sensitive and that is a measured fact, not a suspicion: splitting the
/// same archive footage on an 8 s gap gave 47 shots per "rally", and 4.5 s was
/// what actually matched the play. A different court, a different camera
/// position, or a busier club night will want different numbers, and the only
/// honest response is to make them reachable.
struct LiveRefereeTuning: Equatable {
  /// Vision pose rate. The offline pipeline samples at 8 fps and everything
  /// downstream (wrist speeds in bbox-heights/s, the +/-0.25 s gate window) is
  /// calibrated at that scale. 9 is a slight margin over it, not a chase for 30.
  var poseHz: Double = 9.0
  /// How much pose history the ring buffer keeps. Must comfortably exceed
  /// `strikeResolveDelayS + rallyWinS` so a resolving onset always has its full
  /// centred activity window in hand.
  var historyS: Double = 12.0
  /// Silence in the *gated strike* stream that proposes a rally end. The
  /// offline analyser splits rallies at 5 s; hand-checking the archive footage
  /// put the real boundary nearer 4.5 s for that venue.
  var rallyGapS: Double = 4.5
  /// A gap this long is an unambiguous break rather than a run of missed
  /// shots. Set from the labelled data: the 5.2 s gap at archive_match2
  /// t=94.4 was mid-rally, the 10.9 s gap at t=102.6 was a real break.
  var gapConfidentS: Double = 9.0
  /// How long an onset waits before it is gated. Must be >= AnalyzerParams
  /// .rallyWinS (1.5 s) or the rally-activity window is only half full when the
  /// gate reads it, which silently weakens the gate that lifted shot precision
  /// from 41% to 71%. The cost is that the whole strike stream — and so every
  /// rally-end proposal — runs this far behind reality.
  var strikeResolveDelayS: Double = 1.6
  /// A "rally" shorter than this is treated as a detector artefact: it opens
  /// and closes, but the confidence model discounts it hard.
  var rallyMinStrikes: Int = 2
  /// Percentile of the session's own recent activity distribution used as the
  /// pass-2 gate, matching AnalyzerParams.rallyActQ.
  var activityQ: Double = AnalyzerParams.rallyActQ
  /// Activity samples are meaningless until there is a distribution to take a
  /// percentile of. Until this much has accumulated the pass-2 gate is OFF and
  /// strikes are marked `gateWarm: false` — the opening seconds of a session
  /// over-detect, and say so rather than pretending.
  var activityWarmupS: Double = 20.0
  /// Rolling window the activity percentile is taken over. Long enough to span
  /// several rallies and their breaks, short enough to follow the venue.
  var activityWindowS: Double = 90.0
  /// Multiplier on the recent p90 swing peak above which an onset overrides the
  /// activity gate outright (an overhead serve into a still-quiet court).
  var strongSwingF: Double = AnalyzerParams.strongSwingF
  /// Strikes retained for the strong-swing percentile.
  var swingHistoryCount: Int = 200
  /// Below this many retained strikes there is no percentile worth taking and
  /// the strong-swing override is disabled.
  var swingHistoryMin: Int = 12
  /// An open rally lasting longer than this is a stuck state machine (strikes
  /// arriving from the next court, say), not a rally. Close it and say so.
  var maxRallyS: Double = 180.0

  static let `default` = LiveRefereeTuning()

  /// Parse a JSON object of overrides. Unknown keys are ignored and malformed
  /// input yields the defaults — a referee must not fail to start because a
  /// debug panel sent a bad number.
  static func parse(_ json: String) -> LiveRefereeTuning {
    var t = LiveRefereeTuning.default
    guard let data = json.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return t }
    func num(_ key: String, _ lo: Double, _ hi: Double) -> Double? {
      guard let v = (raw[key] as? NSNumber)?.doubleValue, v.isFinite, v >= lo, v <= hi else {
        return nil
      }
      return v
    }
    if let v = num("poseHz", 1, 30) { t.poseHz = v }
    if let v = num("historyS", 4, 60) { t.historyS = v }
    if let v = num("rallyGapS", 1, 30) { t.rallyGapS = v }
    if let v = num("gapConfidentS", 1, 60) { t.gapConfidentS = v }
    if let v = num("strikeResolveDelayS", AnalyzerParams.rallyWinS, 10) { t.strikeResolveDelayS = v }
    if let v = num("rallyMinStrikes", 1, 20) { t.rallyMinStrikes = Int(v) }
    if let v = num("activityQ", 0, 100) { t.activityQ = v }
    if let v = num("activityWarmupS", 0, 600) { t.activityWarmupS = v }
    if let v = num("activityWindowS", 10, 3600) { t.activityWindowS = v }
    if let v = num("strongSwingF", 0, 10) { t.strongSwingF = v }
    if let v = num("swingHistoryCount", 10, 5000) { t.swingHistoryCount = Int(v) }
    if let v = num("swingHistoryMin", 1, 1000) { t.swingHistoryMin = Int(v) }
    if let v = num("maxRallyS", 10, 3600) { t.maxRallyS = v }
    // Invariants the parser enforces rather than trusting the caller with.
    t.gapConfidentS = max(t.gapConfidentS, t.rallyGapS)
    t.strikeResolveDelayS = max(t.strikeResolveDelayS, AnalyzerParams.rallyWinS)
    t.historyS = max(t.historyS, t.strikeResolveDelayS + AnalyzerParams.rallyWinS + 2.0)
    return t
  }

  var payload: [String: Any] {
    [
      "poseHz": round2(poseHz),
      "historyS": round2(historyS),
      "rallyGapS": round2(rallyGapS),
      "gapConfidentS": round2(gapConfidentS),
      "strikeResolveDelayS": round2(strikeResolveDelayS),
      "rallyMinStrikes": rallyMinStrikes,
      "activityQ": round2(activityQ),
      "activityWarmupS": round2(activityWarmupS),
      "activityWindowS": round2(activityWindowS),
      "strongSwingF": round2(strongSwingF),
      "swingHistoryCount": swingHistoryCount,
      "swingHistoryMin": swingHistoryMin,
      "maxRallyS": round2(maxRallyS),
    ]
  }
}

// MARK: - Confidence

/// How much to believe a rally-end proposal.
///
/// The construction is deliberately multiplicative and deliberately capped: a
/// confidence is `heuristicPrior` times one factor per measured failure mode,
/// each in [floor, 1]. It can therefore never exceed the oracle accuracy of the
/// heuristic itself, which is the honest ceiling, and it drops the moment any
/// of the labelled failure modes is present in the evidence.
///
/// The factor floors below are judgement, not measurement — with 11 labelled
/// rallies there is nothing to fit them to, and pretending otherwise would be
/// the dishonest move. They are set so that a proposal carrying a known failure
/// mode lands in the "ask" band rather than the "propose" one.
enum LiveConfidence {
  /// Phase 1 oracle: 8/11 = 72.7%, Wilson 95% CI [43.4%, 90.3%], n = 11
  /// labellable rallies across three clips (per clip 7/8, 0/1, 1/2). All three
  /// misses were the last striker LOSING — a scrambling retrieval that failed,
  /// which is exactly the case a camera without ball tracking cannot see.
  static let heuristicPrior = 0.727
  static let heuristicPriorCILow = 0.434
  static let heuristicPriorCIHigh = 0.903
  static let heuristicSampleSize = 11

  /// Confidence at which a UI could reasonably pre-confirm the proposal. Set
  /// ABOVE `heuristicPrior` on purpose: at today's measured accuracy nothing
  /// can reach it, so the app asks. The band exists so that a future
  /// measurement can change the UX without changing the UI code.
  static let confirmBand = 0.85
  /// Below this, do not put a default under the human's thumb — show both
  /// players and let them choose. Above a coin flip on purpose: `confidence` is
  /// P(the proposed player actually won), so lighting up a button at 0.45 would
  /// be steering the human toward the LESS likely player. 0.55 is the lowest
  /// value at which a suggestion is better than no suggestion.
  static let proposeBand = 0.55

  /// Failure mode: the silence in the shot stream is missed shots, not a break
  /// (archive_match2 t=94.4 — a 5.2 s gap with the players moving at rally pace
  /// straight through it).
  ///
  /// The test is whether court activity FELL during the gap relative to the
  /// rally itself. Note the ceiling as well as the floor: Phase 1 tried a
  /// smoothed player-speed threshold to separate breaks from play and it
  /// failed — jogging back to the service box is not separable from rally
  /// movement. So a quiet gap is weak evidence that must never on its own
  /// carry a proposal towards certainty, while a gap that is still at full
  /// rally pace is strong evidence AGAINST the break being real. The factor is
  /// therefore asymmetric by design: it can veto, it cannot bless.
  static let gapFloor = 0.35
  static let gapCeiling = 0.85
  /// Gap activity at or above this fraction of the rally's own activity means
  /// the players never stopped — treat the "break" as missed shots.
  static let gapStillPlayingRatio = 0.8
  /// Failure mode: the detector's last "shot" is often a floor bounce or a ball
  /// pickup after the point is over, and those are weak swings next to the
  /// rally's real strikes.
  static let strikeQualityFloor = 0.40
  /// Failure mode: both players swinging inside the same second makes striker
  /// attribution a coin flip.
  static let attributionFloor = 0.35
  /// Margin at which attribution counts as fully decisive.
  static let attributionFull = 0.50
  /// Failure mode: tracking dropouts — the near player occludes the far one
  /// through the glass, or the camera loses them entirely.
  static let trackingFloor = 0.40

  static func band(_ confidence: Double) -> String {
    if confidence >= confirmBand { return "confirm" }
    if confidence >= proposeBand { return "propose" }
    return "ask"
  }
}

// MARK: - Events

/// What the engine tells JS. `striker`/`proposedWinner` are the TRACKER's own
/// identities — "A" is whichever player was leftmost the first time two people
/// were seen on court, nothing more. They are not the referee's player 1 and
/// player 2, and the JS side must let a human bind them (and re-bind them,
/// since a tracker can swap).
enum LiveRefereeEvent {
  case rallyStarted(LiveRallyStartEvent)
  case strike(LiveStrikeEvent)
  case rallyEnded(LiveRallyEndEvent)
}

struct LiveRallyStartEvent {
  /// Seconds since the capture session started.
  let t: Double
  let firstStriker: String

  var payload: [String: Any] {
    ["t": round3(t), "firstStriker": firstStriker]
  }
}

struct LiveStrikeEvent {
  let t: Double
  let striker: String
  /// Swing measure — see StrikeCandidate.peak for the units caveat.
  let peak: Double
  /// 0 = coin flip between the two players, 1 = only one of them moved.
  let margin: Double
  let fromWrist: Bool
  /// 1-based index within the current rally.
  let indexInRally: Int
  /// False while the activity distribution is still warming up, i.e. this
  /// strike skipped the gate that rejects the neighbouring courts.
  let gateWarm: Bool

  var payload: [String: Any] {
    [
      "t": round3(t),
      "striker": striker,
      "peak": round3(peak),
      "margin": round3(margin),
      "fromWrist": fromWrist,
      "indexInRally": indexInRally,
      "gateWarm": gateWarm,
    ]
  }
}

/// Why the engine thinks the rally is over. Never "because the ball bounced
/// twice" — it cannot see the ball.
enum LiveRallyEndTrigger: String {
  /// No gated strike for `rallyGapS`. The only trigger that happens in play.
  case silence
  /// A strike arrived that was already past the gap from the previous one —
  /// defensive; the silence timer normally fires first.
  case lateStrike = "late-strike"
  /// The state machine has been in one "rally" past `maxRallyS`.
  case maxDuration = "max-duration"
}

struct LiveRallyEndEvent {
  let rallyStartT: Double
  let lastStrikeT: Double
  /// Session time at which the engine made the call.
  let decidedAtT: Double
  /// Observed silence in the gated strike stream, in seconds.
  let gapS: Double
  let strikes: Int
  /// The last player to strike, or nil when there is no usable last strike.
  /// NOT a decision — see the file header.
  let proposedWinner: String?
  let confidence: Double
  /// "confirm" | "propose" | "ask" — what the UI should do with this.
  let recommendation: String
  let trigger: LiveRallyEndTrigger
  let factors: [String: Double]
  let why: String

  var payload: [String: Any] {
    var out: [String: Any] = [
      "rallyStartT": round3(rallyStartT),
      "lastStrikeT": round3(lastStrikeT),
      "decidedAtT": round3(decidedAtT),
      "gapS": round3(gapS),
      "strikes": strikes,
      "confidence": round3(confidence),
      "recommendation": recommendation,
      "trigger": trigger.rawValue,
      "why": why,
      "factors": factors.mapValues { round3($0) },
      "ceiling": round3(LiveConfidence.heuristicPrior),
      "ceilingSampleSize": LiveConfidence.heuristicSampleSize,
    ]
    // NSNull rather than an absent key: a JS consumer reading
    // `event.proposedWinner` should get null, not undefined-because-typo.
    out["proposedWinner"] = proposedWinner ?? NSNull()
    return out
  }
}

// MARK: - Engine

/// The rally state machine. Feed it pose frames and audio onsets in capture
/// order; it returns the events they produced.
///
/// Not thread-safe. LiveRefereeSession serialises all access behind one lock.
final class LiveRallyEngine {
  private(set) var tuning: LiveRefereeTuning

  // Bounded pose history. Parallel arrays because every helper this shares
  // with the offline pipeline (peakWristSpeed, anklePathLength,
  // rallyActivityAt, lowerBound) takes exactly this shape.
  private var times: [Double] = []
  private var frames: [[String: PlayerDetection]] = []

  /// Rolling activity samples for the pass-2 percentile, oldest-first, paired
  /// with the frame time they were measured at so the window can be trimmed.
  private var activityT: [Double] = []
  private var activityV: [Double] = []
  /// Frame time of the most recent activity sample taken, so each frame is
  /// scored exactly once.
  private var lastActivityT = -Double.infinity

  /// Recent gated swing peaks, for the strong-swing override percentile.
  private var swingPeaks: [Double] = []

  /// Onsets waiting for their gate window to fill, oldest-first.
  private var pendingOnsets: [LiveOnset] = []

  private struct OpenRally {
    var startT: Double
    var strikes: [StrikeCandidate]
    var framesSeen: Int
    var framesBothTracked: Int
  }

  private var rally: OpenRally?
  /// Monotonic capture clock: the latest timestamp seen on any input.
  private(set) var clock = 0.0
  private var started = false

  init(tuning: LiveRefereeTuning = .default) {
    self.tuning = tuning
  }

  /// Wipe all state. Called when a session stops, so a second session does not
  /// inherit the first one's rally.
  func reset() {
    times.removeAll(keepingCapacity: true)
    frames.removeAll(keepingCapacity: true)
    activityT.removeAll(keepingCapacity: true)
    activityV.removeAll(keepingCapacity: true)
    swingPeaks.removeAll(keepingCapacity: true)
    pendingOnsets.removeAll(keepingCapacity: true)
    lastActivityT = -.infinity
    rally = nil
    clock = 0
    started = false
  }

  /// True once the activity distribution is long enough to take a percentile of.
  var activityWarm: Bool {
    guard let first = activityT.first, let last = activityT.last else { return false }
    return last - first >= tuning.activityWarmupS
  }

  var openRallyStrikes: Int { rally?.strikes.count ?? 0 }

  // MARK: Inputs

  /// One sampled pose frame. `players` is the tracker's output for that frame.
  @discardableResult
  func addPoseFrame(t: Double, players: [String: PlayerDetection]) -> [LiveRefereeEvent] {
    advance(clockTo: t)
    // Out-of-order frames would corrupt every lowerBound below. AVFoundation
    // delivers in order; drop anything that is not, rather than trusting it.
    if let last = times.last, t <= last { return pump() }
    times.append(t)
    frames.append(players)
    evictHistory()
    if rally != nil {
      rally?.framesSeen += 1
      if players["A"] != nil && players["B"] != nil { rally?.framesBothTracked += 1 }
    }
    sampleActivity()
    return pump()
  }

  /// One picked audio onset. It is queued, not gated — the gate needs
  /// `strikeResolveDelayS` of pose frames after it.
  @discardableResult
  func addOnset(_ onset: LiveOnset) -> [LiveRefereeEvent] {
    advance(clockTo: onset.t)
    pendingOnsets.append(onset)
    return pump()
  }

  /// Advance time without new data — lets the silence timer fire even if the
  /// microphone has gone quiet and no onsets are arriving.
  @discardableResult
  func tick(now: Double) -> [LiveRefereeEvent] {
    advance(clockTo: now)
    return pump()
  }

  // MARK: Internals

  private func advance(clockTo t: Double) {
    if t > clock { clock = t }
    started = true
  }

  private func evictHistory() {
    let cutoff = clock - tuning.historyS
    var drop = 0
    while drop < times.count && times[drop] < cutoff { drop += 1 }
    if drop > 0 {
      times.removeFirst(drop)
      frames.removeFirst(drop)
    }
  }

  /// Score every pose frame whose centred activity window has just filled.
  ///
  /// The window is +/-AnalyzerParams.rallyWinS, so a frame can only be scored
  /// once the clock has passed it by that much — the same centred window the
  /// offline gate uses, paid for with latency instead of hindsight.
  private func sampleActivity() {
    let ready = clock - AnalyzerParams.rallyWinS
    guard let newest = times.last, newest >= 0 else { return }
    // Nothing to do unless some unscored frame is now old enough.
    guard times.contains(where: { $0 > lastActivityT && $0 <= ready }) else { return }
    let per = wristSpeedFrames(trackFrames: frames, times: times)
    for i in 0..<times.count where times[i] > lastActivityT && times[i] <= ready {
      activityT.append(times[i])
      activityV.append(rallyActivityAt(per: per, times: times, index: i))
      lastActivityT = times[i]
    }
    trimActivity()
  }

  private func trimActivity() {
    let cutoff = clock - tuning.activityWindowS
    var drop = 0
    while drop < activityT.count && activityT[drop] < cutoff { drop += 1 }
    if drop > 0 {
      activityT.removeFirst(drop)
      activityV.removeFirst(drop)
    }
  }

  /// Resolve everything that is now resolvable, then check the silence timer.
  private func pump() -> [LiveRefereeEvent] {
    guard started else { return [] }
    var events: [LiveRefereeEvent] = []
    let resolvedTo = clock - tuning.strikeResolveDelayS

    while let onset = pendingOnsets.first, onset.t <= resolvedTo {
      pendingOnsets.removeFirst()
      if let strike = gate(onset) {
        events.append(contentsOf: accept(strike))
      }
    }

    // The strike stream is only complete up to `resolvedTo`, so silence is
    // measured against that, not against the wall clock — otherwise every
    // rally would "end" `strikeResolveDelayS` early and then be reopened by
    // the strike that was still in flight.
    if let open = rally, let last = open.strikes.last {
      if resolvedTo - last.t >= tuning.rallyGapS {
        events.append(contentsOf: close(trigger: .silence, at: last.t + tuning.rallyGapS))
      } else if clock - open.startT >= tuning.maxRallyS {
        events.append(contentsOf: close(trigger: .maxDuration, at: clock))
      }
    }
    return events
  }

  /// Pass 1 (shared with the offline analyser) plus pass 2 (rolling percentile).
  private func gate(_ onset: LiveOnset) -> StrikeCandidate? {
    guard let candidate = gateOnsetToStriker(
      trackFrames: frames, times: times, t: onset.t, audioAvailable: true
    ).candidate else { return nil }

    // Pass 2: the onset also has to land while a rally is being played on THIS
    // court. Offline this is a percentile of the whole clip's activity; live it
    // is a percentile of the last `activityWindowS`. Until that window is long
    // enough the gate is off — over-detecting and saying so beats gating on a
    // percentile of four samples.
    guard activityWarm, !activityV.isEmpty else { return candidate }
    let threshold = percentile(activityV, tuning.activityQ)
    let strongThreshold = swingPeaks.count >= tuning.swingHistoryMin
      ? tuning.strongSwingF * percentile(swingPeaks, 90)
      : Double.infinity
    let act = activityNear(onset.t)
    if act < threshold && candidate.peak < strongThreshold { return nil }
    return candidate
  }

  /// The activity sample nearest a time, or 0 when none is close enough.
  private func activityNear(_ t: Double) -> Double {
    guard !activityT.isEmpty else { return 0 }
    var best = 0.0
    var bestDt = Double.infinity
    // Activity samples are dense (one per pose frame) and the search starts
    // from the tail, where the onset being resolved always is.
    for i in stride(from: activityT.count - 1, through: 0, by: -1) {
      let dt = abs(activityT[i] - t)
      if dt < bestDt {
        bestDt = dt
        best = activityV[i]
      } else if activityT[i] < t - 1.0 {
        break // sorted ascending: it only gets worse from here
      }
    }
    return bestDt <= AnalyzerParams.nearestTrackedMaxDt ? best : 0
  }

  private func accept(_ strike: StrikeCandidate) -> [LiveRefereeEvent] {
    var events: [LiveRefereeEvent] = []
    swingPeaks.append(strike.peak)
    if swingPeaks.count > tuning.swingHistoryCount {
      swingPeaks.removeFirst(swingPeaks.count - tuning.swingHistoryCount)
    }

    if var open = rally, let last = open.strikes.last {
      if strike.t - last.t >= tuning.rallyGapS {
        // Should be unreachable: the silence timer in pump() runs on every
        // input and fires first. Kept because "unreachable" is a claim about
        // scheduling, and a referee should not depend on one.
        events.append(contentsOf: close(trigger: .lateStrike, at: last.t + tuning.rallyGapS))
      } else {
        open.strikes.append(strike)
        rally = open
        events.append(.strike(LiveStrikeEvent(
          t: strike.t,
          striker: strike.pid,
          peak: strike.peak,
          margin: strike.margin,
          fromWrist: strike.fromWrist,
          indexInRally: open.strikes.count,
          gateWarm: activityWarm
        )))
        return events
      }
    }

    rally = OpenRally(startT: strike.t, strikes: [strike], framesSeen: 0, framesBothTracked: 0)
    events.append(.rallyStarted(LiveRallyStartEvent(t: strike.t, firstStriker: strike.pid)))
    events.append(.strike(LiveStrikeEvent(
      t: strike.t,
      striker: strike.pid,
      peak: strike.peak,
      margin: strike.margin,
      fromWrist: strike.fromWrist,
      indexInRally: 1,
      gateWarm: activityWarm
    )))
    return events
  }

  private func close(trigger: LiveRallyEndTrigger, at decidedAt: Double) -> [LiveRefereeEvent] {
    guard let open = rally else { return [] }
    rally = nil
    guard let last = open.strikes.last else { return [] }

    let gapS = decidedAt - last.t
    let quiet = gapQuietening(open: open, last: last, decidedAt: decidedAt) ?? 0
    let factors = confidenceFactors(open: open, last: last, quiet: quiet)
    let confidence = factors.values.reduce(LiveConfidence.heuristicPrior, *)
    let event = LiveRallyEndEvent(
      rallyStartT: open.startT,
      lastStrikeT: last.t,
      decidedAtT: decidedAt,
      gapS: gapS,
      strikes: open.strikes.count,
      proposedWinner: last.pid,
      confidence: confidence,
      recommendation: LiveConfidence.band(confidence),
      trigger: trigger,
      factors: factors,
      why: whyText(
        open: open, last: last, gapS: gapS, quiet: quiet, trigger: trigger, factors: factors
      )
    )
    return [.rallyEnded(event)]
  }

  /// Median of the scored activity samples in a half-open time range, or nil
  /// when the range holds none.
  private func activityMedian(from: Double, to: Double) -> Double? {
    var vals: [Double] = []
    for i in 0..<activityT.count where activityT[i] >= from && activityT[i] < to {
      vals.append(activityV[i])
    }
    return vals.isEmpty ? nil : median(vals)
  }

  /// How much the court quietened during the gap, 0 (still at full rally pace)
  /// to 1 (stopped dead). nil when there is nothing to compare.
  private func gapQuietening(open: OpenRally, last: StrikeCandidate, decidedAt: Double) -> Double? {
    guard let during = activityMedian(from: open.startT, to: last.t), during > 1e-9,
          let after = activityMedian(from: last.t, to: decidedAt)
    else { return nil }
    return clamp01(1 - after / during)
  }

  private func confidenceFactors(
    open: OpenRally, last: StrikeCandidate, quiet: Double
  ) -> [String: Double] {
    // Gap: did the court actually go quiet, or are these missed shots?
    // Unmeasurable (no activity samples yet) arrives here as 0 and scores at
    // the floor rather than being skipped — an unverifiable break is not a
    // verified one.
    let gapFactor = LiveConfidence.gapFloor
      + (LiveConfidence.gapCeiling - LiveConfidence.gapFloor) * quiet

    // Strike quality: how the last strike compares with the rally's own.
    let peaks = open.strikes.map { $0.peak }
    let reference = median(peaks)
    let ratio = reference > 0 ? clamp01(last.peak / reference) : 1.0
    let qualityFactor = LiveConfidence.strikeQualityFloor
      + (1 - LiveConfidence.strikeQualityFloor) * ratio

    // Attribution: how decisively the last strike belonged to one player. The
    // ankle fallback is weaker evidence than a wrist, so it never scores full.
    let decisiveness = clamp01(last.margin / LiveConfidence.attributionFull)
    var attributionFactor = LiveConfidence.attributionFloor
      + (1 - LiveConfidence.attributionFloor) * decisiveness
    if !last.fromWrist { attributionFactor *= 0.8 }

    // Rally length: a one-shot "rally" is a segmentation artefact.
    let n = open.strikes.count
    let lengthFactor: Double
    if n >= tuning.rallyMinStrikes + 1 {
      lengthFactor = 1.0
    } else if n >= tuning.rallyMinStrikes {
      lengthFactor = 0.75
    } else {
      lengthFactor = 0.5
    }

    // Tracking: how much of the rally had both players in hand at once.
    let coverage = open.framesSeen > 0
      ? Double(open.framesBothTracked) / Double(open.framesSeen)
      : 0.0
    let trackingFactor = LiveConfidence.trackingFloor
      + (1 - LiveConfidence.trackingFloor) * clamp01(coverage)

    return [
      "gap": gapFactor,
      "strikeQuality": qualityFactor,
      "attribution": attributionFactor,
      "rallyLength": lengthFactor,
      "tracking": trackingFactor,
    ]
  }

  /// A sentence a human can check the machine against. It says what was
  /// observed and what is uncertain; it never says a point was won.
  private func whyText(
    open: OpenRally,
    last: StrikeCandidate,
    gapS: Double,
    quiet: Double,
    trigger: LiveRallyEndTrigger,
    factors: [String: Double]
  ) -> String {
    if trigger == .maxDuration {
      return "No break detected for \(Int(tuning.maxRallyS)) s — closing this as a stuck "
        + "detection, not as a point. Score it yourself."
    }
    var parts: [String] = []
    parts.append(
      "Player \(last.pid) struck last, then \(round1(gapS)) s with no detected shot "
      + "(threshold \(round1(tuning.rallyGapS)) s)."
    )
    // The single most dangerous case, and the one that is actually observable:
    // the shot stream went quiet but the players did not. On the labelled
    // footage that pattern was a run of MISSED shots in the middle of a live
    // rally, not a break.
    if quiet <= (1 - LiveConfidence.gapStillPlayingRatio) {
      parts.append(
        "Both players are still moving at rally pace — the shots may simply have been missed "
        + "rather than the rally having ended."
      )
    }
    if (factors["strikeQuality"] ?? 1) < 0.7 {
      parts.append("The last shot was weak for this rally; it may be a bounce or a pickup.")
    }
    if (factors["attribution"] ?? 1) < 0.6 {
      parts.append("Both players were moving — which of them struck it is not clear.")
    }
    if (factors["tracking"] ?? 1) < 0.7 {
      parts.append("Both players were only in view for part of the rally.")
    }
    if open.strikes.count < tuning.rallyMinStrikes {
      parts.append("Only \(open.strikes.count) shot detected in this rally.")
    }
    if !activityWarm {
      parts.append("Still learning this court's noise — shots from other courts may be counted.")
    }
    parts.append("The ball is not tracked, so the reason the rally ended was not observed.")
    return parts.joined(separator: " ")
  }
}
