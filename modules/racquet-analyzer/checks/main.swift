// Off-device harness for LiveRallyEngine + StreamingOnsetDetector.
// Drives the engine with synthetic pose frames and onsets and prints events.
// Not shipped — a check that the state machine actually transitions.

import Foundation

func joint(_ x: Double, _ y: Double) -> JointPoint { JointPoint(x: x, y: y, conf: 0.9) }

/// A player detection with wrists at a given offset, bbox height 200 px.
func det(courtX: Double, courtY: Double, wristX: Double, wristY: Double) -> PlayerDetection {
  var joints: [String: JointPoint] = [:]
  joints["leftWrist"] = joint(wristX, wristY)
  joints["rightWrist"] = joint(wristX + 10, wristY)
  joints["leftAnkle"] = joint(400, 700)
  joints["rightAnkle"] = joint(420, 700)
  joints["leftShoulder"] = joint(390, 520)
  joints["rightShoulder"] = joint(430, 520)
  return PlayerDetection(
    joints: joints,
    court: (courtX, courtY),
    area: 200 * 80,
    bboxH: 200,
    posConf: 0.9,
    app: nil,
    box: BBox(minX: 380, minY: 500, maxX: 460, maxY: 700)
  )
}

let tuning = LiveRefereeTuning.default
let engine = LiveRallyEngine(tuning: tuning)

let hz = tuning.poseHz
let dt = 1.0 / hz
let duration = 120.0

/// Rally windows [start, end): players swing hard. Outside them they drift.
///
/// (70, 92) is the archive_match2 t=94.4 case: the players keep moving at rally
/// pace all the way through, but the onset stream has a 6 s hole in it (missed
/// shots). The engine MUST still propose — it cannot know — but it must mark
/// the proposal down, because the court never went quiet.
let rallies: [(Double, Double)] = [(25, 40), (48, 62), (70, 92)]
/// Onsets: (time, "which player is striking"). Placed inside rally windows,
/// plus two decoys in a break to exercise the activity gate.
var onsets: [(Double, String)] = []
for (s, e) in rallies {
  var t = s + 0.6
  var flip = true
  while t < e - 0.4 {
    // The 6 s hole in the third rally's shot stream: missed shots, not a break.
    if !(s == 70 && t > 76 && t < 82) {
      onsets.append((t, flip ? "A" : "B"))
    }
    flip.toggle()
    t += 1.1
  }
}
// Decoys from the court next door, during a break with both players idle.
onsets.append((44.0, "A"))
onsets.append((45.2, "B"))
onsets.sort { $0.0 < $1.0 }

func inRally(_ t: Double) -> Bool { rallies.contains { t >= $0.0 && t < $0.1 } }

/// The player nearest in time to an onset "swings" — a big wrist excursion.
func swingerAt(_ t: Double) -> String? {
  var best: (Double, String)?
  for (ot, pid) in onsets where abs(ot - t) < 0.2 {
    let d = abs(ot - t)
    if best == nil || d < best!.0 { best = (d, pid) }
  }
  return best?.1
}

var allEvents: [LiveRefereeEvent] = []
var t = 0.0
var phase = 0.0
while t < duration {
  let rallying = inRally(t)
  // Rally movement: both wrists oscillating at a few bbox-heights/s.
  // Break movement: a slow drift, well under the gate.
  let amp = rallying ? 70.0 : 6.0
  phase += rallying ? 2.2 : 0.4
  let swinger = swingerAt(t)
  var players: [String: PlayerDetection] = [:]
  for (i, pid) in ["A", "B"].enumerated() {
    let extra = (swinger == pid) ? 60.0 : 0.0
    let wx = 400 + (amp + extra) * sin(phase + Double(i) * 1.3)
    let wy = 560 + (amp + extra) * cos(phase + Double(i) * 1.3)
    players[pid] = det(
      courtX: 2.0 + Double(i) * 2.4, courtY: 5.0 + Double(i) * 1.0, wristX: wx, wristY: wy
    )
  }
  allEvents.append(contentsOf: engine.addPoseFrame(t: t, players: players))
  for (ot, _) in onsets where ot > t - dt && ot <= t {
    allEvents.append(contentsOf: engine.addOnset(LiveOnset(t: ot, strength: 0.4)))
  }
  t += dt
}
allEvents.append(contentsOf: engine.tick(now: duration + 12))

var starts = 0
var strikes = 0
var ends = 0
for e in allEvents {
  switch e {
  case .rallyStarted(let s):
    starts += 1
    print(String(format: "RALLY START t=%.2f first=%@", s.t, s.firstStriker))
  case .strike(let s):
    strikes += 1
    print(String(
      format: "  strike t=%.2f %@ peak=%.2f margin=%.2f wrist=%@ #%d warm=%@",
      s.t, s.striker, s.peak, s.margin, s.fromWrist ? "y" : "n", s.indexInRally,
      s.gateWarm ? "y" : "n"
    ))
  case .rallyEnded(let e):
    ends += 1
    print(String(
      format: "RALLY END start=%.2f last=%.2f decided=%.2f strikes=%d winner=%@ conf=%.3f band=%@ trigger=%@",
      e.rallyStartT, e.lastStrikeT, e.decidedAtT, e.strikes,
      e.proposedWinner ?? "nil", e.confidence, e.recommendation, e.trigger.rawValue
    ))
    let f = e.factors.sorted { $0.key < $1.key }
      .map { String(format: "%@=%.2f", $0.key, $0.value) }.joined(separator: " ")
    print("    factors: \(f)")
    print("    why: \(e.why)")
    if e.confidence > LiveConfidence.heuristicPrior {
      print("    *** BUG: confidence exceeded the oracle ceiling ***")
    }
  }
}
print("---")
print("scripted rallies=\(rallies.count) onsets=\(onsets.count)")
print("engine starts=\(starts) strikes=\(strikes) ends=\(ends)")

// --- Assertions -----------------------------------------------------------

var failures: [String] = []
func check(_ name: String, _ condition: Bool, _ detail: String = "") {
  if condition {
    print("PASS  \(name)")
  } else {
    print("FAIL  \(name) \(detail)")
    failures.append(name)
  }
}

var endEvents: [LiveRallyEndEvent] = []
var strikeEvents: [LiveStrikeEvent] = []
for e in allEvents {
  if case .rallyEnded(let x) = e { endEvents.append(x) }
  if case .strike(let x) = e { strikeEvents.append(x) }
}

// Three scripted rallies, but the third has a 6 s hole in its shot stream, so
// the engine must split it in two. It cannot know the hole is missed shots —
// the point of the check is what it says about the split, not that it avoids it.
check("rally ends detected", ends == 4, "got \(ends), want 4")
check("every rally end has a proposed winner", endEvents.allSatisfy { $0.proposedWinner != nil })

// The invariant the whole feature rests on.
check(
  "confidence never exceeds the measured oracle ceiling",
  endEvents.allSatisfy { $0.confidence <= LiveConfidence.heuristicPrior + 1e-9 },
  "max \(endEvents.map { $0.confidence }.max() ?? 0)"
)

// The decoys at 44.0 and 45.2 land in a break with both players idle. The
// pass-2 rally-activity gate exists to reject exactly these — racquet strikes
// from the neighbouring court.
let decoyStrikes = strikeEvents.filter { abs($0.t - 44.0) < 0.05 || abs($0.t - 45.2) < 0.05 }
check(
  "onsets during an idle break are gated out",
  decoyStrikes.isEmpty,
  "\(decoyStrikes.count) got through"
)

// The archive_match2 t=94.4 case: the shot stream went quiet, the players did
// not. The engine must still propose (it cannot know), but it must mark the
// proposal down to "ask" and say why in words a human can check.
let fakeBreak = endEvents.first { abs($0.lastStrikeT - 75.0) < 0.5 }
check("the missed-shot break was detected as a rally end", fakeBreak != nil)
if let fake = fakeBreak {
  check(
    "a break the players played through lands in the ask band",
    fake.recommendation == "ask",
    "got \(fake.recommendation) at conf \(round3(fake.confidence))"
  )
  check(
    "...and says so in plain words",
    fake.why.contains("still moving at rally pace"),
    fake.why
  )
}

// A genuine break, with the players stopped, must score higher than one they
// played straight through — otherwise the confidence carries no information.
let realBreak = endEvents.first { abs($0.lastStrikeT - 38.8) < 0.5 }
if let real = realBreak, let fake = fakeBreak {
  check(
    "a genuine break outscores a played-through one",
    real.confidence > fake.confidence * 1.5,
    "\(round3(real.confidence)) vs \(round3(fake.confidence))"
  )
}

// --- StreamingOnsetDetector: does it pick a transient out of noise? ---
let sr = 44100.0
let onsetDet = StreamingOnsetDetector(sampleRate: sr)
var picked: [Double] = []
var seed: UInt64 = 12345
func rnd() -> Float {
  seed = seed &* 6364136223846793005 &+ 1442695040888963407
  return Float(Double(seed >> 33) / Double(UInt64(1) << 31) - 1.0) * 0.02
}
let strikeTimes: [Double] = [6.0, 6.9, 8.1, 9.4, 12.0]
let chunk = 1024
var sampleIdx = 0
let totalSamples = Int(20.0 * sr)
while sampleIdx < totalSamples {
  var buf = [Float](repeating: 0, count: chunk)
  for i in 0..<chunk {
    let ts = Double(sampleIdx + i) / sr
    var v = rnd()
    for st in strikeTimes where ts >= st && ts < st + 0.012 {
      let env = Float(exp(-(ts - st) / 0.003))
      v += env * 0.8 * Float(sin(2 * Double.pi * 2200 * (ts - st)))
    }
    buf[i] = v
  }
  onsetDet.append(samples: buf) { picked.append($0.t) }
  sampleIdx += chunk
}
onsetDet.flush(now: 25.0) { picked.append($0.t) }
print("---")
print("audio: scripted strikes at \(strikeTimes)")
print("audio: streaming picked \(picked.count) at \(picked.map { round2($0) })")

// The same signal through the OFFLINE batch detector, so the port can be
// compared against the algorithm it claims to restate.
seed = 12345
var all = [Float](repeating: 0, count: totalSamples)
for i in 0..<totalSamples {
  let ts = Double(i) / sr
  var v = rnd()
  for st in strikeTimes where ts >= st && ts < st + 0.012 {
    let env = Float(exp(-(ts - st) / 0.003))
    v += env * 0.8 * Float(sin(2 * Double.pi * 2200 * (ts - st)))
  }
  all[i] = v
}
let batch = audioOnsets(rmsEnvelope(all, sampleRate: sr))
print("audio: batch     picked \(batch.count) at \(batch.map { round2($0) })")
let matched = strikeTimes.filter { s in picked.contains { abs($0 - s) < 0.06 } }.count
let batchMatched = strikeTimes.filter { s in batch.contains { abs($0 - s) < 0.06 } }.count
print("audio: recall streaming \(matched)/\(strikeTimes.count), batch \(batchMatched)/\(strikeTimes.count)")

// The streaming port claims to restate Audio.swift, so it has to find what the
// batch detector finds. Both fire on noise peaks too — that is the algorithm's
// known ~63% shot precision, which the pass-2 activity gate exists to clean up
// downstream, not something this port introduced.
check("streaming onset detector finds every scripted strike", matched == strikeTimes.count)
check("...and does not lag the batch detector", matched >= batchMatched)
let agreement = picked.filter { p in batch.contains { abs($0 - p) < 0.06 } }.count
check(
  "streaming and batch agree on most picks",
  Double(agreement) / Double(max(picked.count, 1)) >= 0.75,
  "\(agreement)/\(picked.count)"
)

print("---")
if failures.isEmpty {
  print("ALL CHECKS PASSED")
} else {
  print("FAILED: \(failures.joined(separator: ", "))")
  exit(1)
}
