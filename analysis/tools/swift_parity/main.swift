// Rally-activity gate parity harness: runs the SHIPPED Swift functions from
// modules/racquet-analyzer/ios/Stats.swift against fixtures frozen from the
// Python reference (analysis/tools/dump_gate_fixture.py) and asserts that every
// intermediate matches, not just the final shot count.
//
// It lives outside modules/racquet-analyzer/ios/ on purpose: the podspec globs
// **/*.swift, so a file with top-level code in there would break the app build.
//
//   .venv/bin/python tools/dump_gate_fixture.py --video samples/archive_match2.mp4 \
//       --corners samples/archive_match2.corners.json --out out/archive_match2_v2 \
//       --json /tmp/gate_archive_match2.json
//   xcrun swiftc -O -o /tmp/gateparity \
//       ../../modules/racquet-analyzer/ios/{Stats,Appearance,Homography}.swift \
//       tools/swift_parity/main.swift
//   /tmp/gateparity /tmp/gate_archive_match2.json ...

import Foundation

// Two engines computing the same quantity in different languages will not agree
// to the last bit — np.hypot is more accurate than sqrt(dx*dx+dy*dy), and
// numpy's percentile lerps as a+(b-a)*f where Swift's does a*(1-f)+b*f. A
// mismatch bigger than this is an algorithm difference, not arithmetic.
let tol = 1e-9

var assertions = 0
var failures: [String] = []

func check(_ ok: Bool, _ what: @autoclosure () -> String) {
  assertions += 1
  if !ok, failures.count < 20 { failures.append(what()) }
  if !ok, failures.count == 20 { failures.append("... further failures suppressed") }
}

/// Signed distance in representable doubles: 0 means the two engines produced
/// the identical bits. Tolerance hides an algorithm change behind "close
/// enough"; this says how much slack is actually being used.
func ulps(_ a: Double, _ b: Double) -> Int64 {
  guard a.isFinite, b.isFinite else { return a == b ? 0 : Int64.max }
  func ordered(_ x: Double) -> Int64 {
    let bits = Int64(bitPattern: x.bitPattern)
    return bits < 0 ? Int64.min &- bits : bits
  }
  return ordered(a) &- ordered(b)
}

func close(_ a: Double, _ b: Double) -> Bool {
  if a.isNaN || b.isNaN { return a.isNaN && b.isNaN }
  if a == b { return true }
  if a.isInfinite || b.isInfinite { return false }
  return abs(a - b) <= tol * max(1.0, max(abs(a), abs(b)))
}

func num(_ any: Any?) -> Double {
  if let d = any as? Double { return d }
  if let n = any as? NSNumber { return n.doubleValue }
  return Double.nan
}

// MARK: - fixture

struct Fixture {
  var clip: String
  var times: [Double]
  var trackFrames: [[String: PlayerDetection]]
  var onsets: [Double]
  var wA: [Double]
  var wB: [Double]
  var act: [Double]
  var actThr: Double
  var strongThr: Double
  var passed: [(t: Double, pid: String, peak: Double)]
  var kept: [(t: Double, pid: String)]
  var nGated: Int
  var nRallyGated: Int
}

func loadFixture(_ path: String) throws -> Fixture {
  let data = try Data(contentsOf: URL(fileURLWithPath: path))
  let root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
  let times = (root["times"] as! [Any]).map { num($0) }
  var frames: [[String: PlayerDetection]] = []
  for row in root["frames"] as! [[String: Any]] {
    var out: [String: PlayerDetection] = [:]
    for (pid, v) in row {
      let d = v as! [String: Any]
      let lw = (d["lw"] as! [Any]).map { num($0) }
      let rw = (d["rw"] as! [Any]).map { num($0) }
      let court = (d["court"] as! [Any]).map { num($0) }
      out[pid] = PlayerDetection(
        joints: [
          "leftWrist": JointPoint(x: lw[0], y: lw[1], conf: lw[2]),
          "rightWrist": JointPoint(x: rw[0], y: rw[1], conf: rw[2]),
        ],
        court: (court[0], court[1]),
        area: 0,
        bboxH: num(d["h"])
      )
    }
    frames.append(out)
  }
  let e = root["expect"] as! [String: Any]
  func series(_ key: String) -> [Double] {
    (e[key] as! [Any]).map { $0 is NSNull ? Double.nan : num($0) }
  }
  return Fixture(
    clip: root["clip"] as! String,
    times: times,
    trackFrames: frames,
    onsets: (root["onsets"] as! [Any]).map { num($0) },
    wA: series("wA"),
    wB: series("wB"),
    act: series("act"),
    actThr: num(e["actThr"]),
    strongThr: num(e["strongThr"]),
    passed: (e["passed"] as! [[Any]]).map { (num($0[0]), $0[1] as! String, num($0[2])) },
    kept: (e["kept"] as! [[Any]]).map { (num($0[0]), $0[1] as! String) },
    nGated: Int(num(e["nGated"])),
    nRallyGated: Int(num(e["nRallyGated"]))
  )
}

// MARK: - the shipped pipeline, as RacquetAnalyzerModule runs it

/// Pass 1 + pass 2 exactly as RacquetAnalyzerModule.analyze does, minus the
/// RawShot construction (which needs joints this fixture deliberately omits).
///
/// `winS` is the swing-gate half-window. It is a parameter, not
/// AnalyzerParams.wristWinS, only because the two engines still disagree on
/// that one constant (Swift 0.25, analyze.py 0.30) for reasons that predate
/// the rally gate; feeding the fixture's value in keeps this harness a test of
/// the gate port rather than a re-report of that known divergence, which is
/// printed separately below.
func runGates(_ f: Fixture, winS: Double) -> (
  passed: [(t: Double, pid: String, peak: Double)],
  kept: [(t: Double, pid: String)],
  act: [Double], actThr: Double, strongThr: Double,
  nGated: Int, nRallyGated: Int
) {
  let times = f.times
  let trackFrames = f.trackFrames
  var passed: [(t: Double, pid: String, peak: Double)] = []
  var nGated = 0
  for t in f.onsets {
    let lo = max(0, lowerBound(times, t - winS))
    let hi = min(times.count - 1, lowerBound(times, t + winS))
    guard hi >= lo else { continue }
    var trav: [String: Double] = [:]
    var obs: [String: Int] = [:]
    for pid in ["A", "B"] {
      let r = peakWristSpeed(trackFrames: trackFrames, times: times, lo: lo, hi: hi, pid: pid)
      trav[pid] = r.peak
      obs[pid] = r.obs
    }
    if (obs["A"] ?? 0) >= 2 || (obs["B"] ?? 0) >= 2 {
      if max(trav["A"] ?? 0, trav["B"] ?? 0) < AnalyzerParams.wristPeakGate {
        nGated += 1
        continue
      }
    } else {
      for pid in ["A", "B"] {
        trav[pid] = anklePathLength(
          trackFrames: trackFrames, times: times, lo: lo, hi: hi, pid: pid
        )
      }
      if max(trav["A"] ?? 0, trav["B"] ?? 0) < AnalyzerParams.ankleGateMeters {
        nGated += 1
        continue
      }
    }
    let pid = (trav["A"] ?? 0) >= (trav["B"] ?? 0) ? "A" : "B"
    passed.append((t, pid, max(trav["A"] ?? 0, trav["B"] ?? 0)))
  }

  let act = rallyActivity(trackFrames: trackFrames, times: times)
  let actThr = act.isEmpty ? 0.0 : percentile(act, AnalyzerParams.rallyActQ)
  let strongThr = passed.isEmpty
    ? Double.infinity
    : AnalyzerParams.strongSwingF * percentile(passed.map { $0.peak }, 90)
  var kept: [(t: Double, pid: String)] = []
  var nRallyGated = 0
  for p in passed {
    var j = min(max(lowerBound(times, p.t), 0), max(times.count - 1, 0))
    if j > 0 && abs(times[j - 1] - p.t) < abs(times[j] - p.t) { j -= 1 }
    if act[j] < actThr && p.peak < strongThr {
      nRallyGated += 1
      continue
    }
    // The shipped tail, verbatim, so these lines are type-checked and run here
    // too. The fixture carries wrists only, so highContact is always false —
    // shot classification is not what this harness is measuring.
    guard let i = nearestTracked(trackFrames: trackFrames, times: times, t: p.t, pid: p.pid),
          let det = trackFrames[i][p.pid] else { continue }
    let shot = RawShot(
      t: p.t,
      pid: p.pid,
      court: det.court,
      highContact: isHighContact(det.joints),
      lowConfidence: det.posConf < ShotClass.poseConfLow
    )
    kept.append((shot.t, shot.pid))
  }
  return (passed, kept, act, actThr, strongThr, nGated, nRallyGated)
}

// MARK: - run

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
  FileHandle.standardError.write(Data("usage: gateparity <fixture.json> ...\n".utf8))
  exit(2)
}

// Guard against the fixture and the engine drifting apart on a constant. Every
// constant the gate reads must match the reference; `wristWinS` is exempted
// because that divergence predates this work, and it is reported instead of
// silently folded into a pass or a fail.
var divergences: [String] = []

func checkParams(_ p: [String: Any], _ clip: String) {
  let want: [(String, Double)] = [
    ("kptConf", AnalyzerParams.kptConf),
    ("wristSpeedMaxDt", AnalyzerParams.wristSpeedMaxDt),
    ("wristPeakGate", AnalyzerParams.wristPeakGate),
    ("ankleGate", AnalyzerParams.ankleGateMeters),
    ("nearestTrackedMaxDt", AnalyzerParams.nearestTrackedMaxDt),
    ("rallyWinS", AnalyzerParams.rallyWinS),
    ("rallyActQ", AnalyzerParams.rallyActQ),
    ("rallyMinObs", Double(AnalyzerParams.rallyMinObs)),
    ("strongSwingF", AnalyzerParams.strongSwingF),
  ]
  for (k, v) in want {
    check(close(num(p[k]), v), "\(clip): param \(k) python=\(num(p[k])) swift=\(v)")
  }
  let winS = num(p["wristWinS"])
  if !close(winS, AnalyzerParams.wristWinS) {
    let line = "wristWinS: analyze.py \(winS) vs Stats.swift \(AnalyzerParams.wristWinS)"
    if !divergences.contains(line) { divergences.append(line) }
  }
}

for path in paths {
  let f = try loadFixture(path)
  let root = try JSONSerialization.jsonObject(
    with: Data(contentsOf: URL(fileURLWithPath: path))
  ) as! [String: Any]
  let params = root["params"] as! [String: Any]
  checkParams(params, f.clip)

  // Step 1 — per-frame wrist speed, every frame, both players.
  var compared = 0
  var exact = 0
  var worstUlps: Int64 = 0
  let per = wristSpeedFrames(trackFrames: f.trackFrames, times: f.times)
  for (pid, want) in [("A", f.wA), ("B", f.wB)] {
    let got = per[pid]!
    check(got.count == want.count, "\(f.clip): w[\(pid)] length \(got.count) != \(want.count)")
    for i in 0..<min(got.count, want.count) {
      check(close(got[i], want[i]),
            "\(f.clip): w[\(pid)][\(i)] t=\(f.times[i]) swift=\(got[i]) python=\(want[i])")
      guard !got[i].isNaN, !want[i].isNaN else { continue }
      compared += 1
      let u = ulps(got[i], want[i])
      if u == 0 { exact += 1 }
      worstUlps = max(worstUlps, abs(u))
    }
  }

  // Step 2 — the activity signal, every frame.
  let r = runGates(f, winS: num(params["wristWinS"]))
  check(r.act.count == f.act.count, "\(f.clip): act length \(r.act.count) != \(f.act.count)")
  var actExact = 0
  for i in 0..<min(r.act.count, f.act.count) {
    check(close(r.act[i], f.act[i]),
          "\(f.clip): act[\(i)] t=\(f.times[i]) swift=\(r.act[i]) python=\(f.act[i])")
    if ulps(r.act[i], f.act[i]) == 0 { actExact += 1 }
    worstUlps = max(worstUlps, abs(ulps(r.act[i], f.act[i])))
  }

  // Step 3 — the two per-clip thresholds. actThr is a percentile OF act, so it
  // frequently coincides exactly with a frame's activity (see the tie count
  // printed below); one ulp of slack there is one flipped shot, and the
  // comparison is `act[j] < actThr`, which equality passes.
  check(close(r.actThr, f.actThr), "\(f.clip): actThr swift=\(r.actThr) python=\(f.actThr)")
  check(close(r.strongThr, f.strongThr),
        "\(f.clip): strongThr swift=\(r.strongThr) python=\(f.strongThr)")
  let thrUlps = ulps(r.actThr, f.actThr)
  let strongUlps = ulps(r.strongThr, f.strongThr)
  let ties = r.act.filter { $0 == r.actThr }.count
  check(thrUlps == 0 || ties == 0,
        "\(f.clip): actThr differs by \(thrUlps) ulp with \(ties) frames exactly on it")

  // Step 4 — the decisions: swing-gate survivors, then rally-gate survivors.
  check(r.nGated == f.nGated, "\(f.clip): nGated swift=\(r.nGated) python=\(f.nGated)")
  check(r.passed.count == f.passed.count,
        "\(f.clip): passed count swift=\(r.passed.count) python=\(f.passed.count)")
  for i in 0..<min(r.passed.count, f.passed.count) {
    check(close(r.passed[i].t, f.passed[i].t),
          "\(f.clip): passed[\(i)].t swift=\(r.passed[i].t) python=\(f.passed[i].t)")
    check(r.passed[i].pid == f.passed[i].pid,
          "\(f.clip): passed[\(i)].pid swift=\(r.passed[i].pid) python=\(f.passed[i].pid)")
    check(close(r.passed[i].peak, f.passed[i].peak),
          "\(f.clip): passed[\(i)].peak swift=\(r.passed[i].peak) python=\(f.passed[i].peak)")
  }
  check(r.nRallyGated == f.nRallyGated,
        "\(f.clip): nRallyGated swift=\(r.nRallyGated) python=\(f.nRallyGated)")
  check(r.kept.count == f.kept.count,
        "\(f.clip): shot count swift=\(r.kept.count) python=\(f.kept.count)")
  for i in 0..<min(r.kept.count, f.kept.count) {
    check(close(r.kept[i].t, f.kept[i].t),
          "\(f.clip): shot[\(i)].t swift=\(r.kept[i].t) python=\(f.kept[i].t)")
    check(r.kept[i].pid == f.kept[i].pid,
          "\(f.clip): shot[\(i)].pid swift=\(r.kept[i].pid) python=\(f.kept[i].pid)")
  }

  // How close the gate came to flipping: a decision that agrees only because
  // both sides rounded the same way is not real agreement.
  var minMargin = Double.infinity
  for p in r.passed {
    var j = min(max(lowerBound(f.times, p.t), 0), max(f.times.count - 1, 0))
    if j > 0 && abs(f.times[j - 1] - p.t) < abs(f.times[j] - p.t) { j -= 1 }
    minMargin = min(minMargin, abs(r.act[j] - r.actThr))
  }
  print(String(
    format: "%@: %d frames, %d onsets -> %d passed swing gate, %d rally-gated, %d shots",
    f.clip, f.times.count, f.onsets.count, r.passed.count, r.nRallyGated, r.kept.count
  ))
  print(String(
    format: "  actThr %.9f (%d ulp from numpy, %d frames sitting exactly on it), "
      + "strongThr %.9f (%d ulp); closest kept/gated decision %.3e from the threshold",
    r.actThr, thrUlps, ties, r.strongThr, strongUlps, minMargin
  ))
  print(String(
    format: "  bit-identical to numpy: %d/%d wrist speeds, %d/%d activity samples; "
      + "worst disagreement %d ulp",
    exact, compared, actExact, r.act.count, worstUlps
  ))

  // What the shipped constants actually produce. Same code, same footage, only
  // the swing-gate window differs — so this is the size of the divergence a
  // user would see between the two engines today.
  if !close(num(params["wristWinS"]), AnalyzerParams.wristWinS) {
    let s = runGates(f, winS: AnalyzerParams.wristWinS)
    print(String(
      format: "  with the SHIPPED wristWinS %.2f: %d shots vs analyze.py's %d (%+d)",
      AnalyzerParams.wristWinS, s.kept.count, r.kept.count, s.kept.count - r.kept.count
    ))
  }
}

print("\n\(assertions) assertions, \(failures.count) failed")
for line in failures.prefix(21) { print("  FAIL " + line) }
if !divergences.isEmpty {
  print("\nENGINE DIVERGENCE (pre-existing, outside the rally-activity gate — the two")
  print("engines will still not agree on shot counts until these are reconciled):")
  for line in divergences { print("  * " + line) }
}
exit(failures.isEmpty ? 0 : 1)
