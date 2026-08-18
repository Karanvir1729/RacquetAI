// Stats.swift — pure-Foundation port of analyze.py's tracking + analytics:
// court geometry, two-player nearest-neighbour tracker with swap guard,
// striker attribution helpers, rally split, retrieval-proxy placement,
// 12x8 coverage heatmap, T-time, transition-entropy predictability, and the
// analysis.json (schemaVersion 1) builder + shape validator.
//
// No AVFoundation/Vision/Expo imports so the whole file compiles standalone
// for off-device unit checks (see the scratchpad check harness).

import Foundation

// MARK: - Constants (analyze.py header block)

enum Court {
  static let width = 6.4
  static let length = 9.75
  static let shortY = 5.44
  static let midX = width / 2.0 // 3.2
  static let tX = midX
  static let tY = shortY
  static let tRadius = 1.5
  static let heatRows = 12
  static let heatCols = 8
  // Detection filter slack (task spec): accept projected ankles in
  // [-1, 7.4] x [-1, 10.75], then clamp into court bounds for cells.
  static let filterLoX = -1.0
  static let filterHiX = 7.4
  static let filterLoY = -1.0
  static let filterHiY = 10.75
}

enum AnalyzerParams {
  static let defaultSampleFps = 8.0
  static let kptConf = 0.3 // KPT_CONF
  static let onsetMergeS = 0.35 // ONSET_MERGE_S
  static let rallyGapS = 5.0 // task spec: rally split on >5 s gaps (analyze.py default 8 s)
  static let wristWinS = 0.25 // task spec: +/-0.25 s gate window (analyze.py WRIST_WIN_S 0.30)
  static let wristPeakGate = 1.9 // WRIST_PEAK_GATE, bbox-heights/s
  static let ankleGateMeters = 0.30 // ANKLE_GATE
  static let wristSpeedMaxDt = 0.4 // peak_wrist_speed dt cap
  static let nearestTrackedMaxDt = 0.6 // nearest_tracked max_dt
  static let minVisibleJoints = 6 // detect_players len(vis) >= 6
  static let audioSampleRate = 22050.0
  static let audioHopS = 0.010 // ~10 ms hop
  static let audioWinS = 0.020 // 20 ms RMS window
  static let onsetMadK = 3.0 // adaptive threshold: median + k*MAD
  static let onsetMedianHalfWinS = 1.0 // sliding-window half width for median/MAD
}

// MARK: - Detections and tracking

struct JointPoint {
  var x: Double // upright image pixels (y down)
  var y: Double
  var conf: Double
}

struct PlayerDetection {
  var joints: [String: JointPoint]
  var court: (x: Double, y: Double) // meters, clamped into court bounds
  var area: Double
  var bboxH: Double
}

/// Port of detect_players: filter raw poses to in-court players (ankle
/// midpoint, hip fallback), keep the 2 biggest by visible-joint bbox area.
func detectPlayers(
  rawPoses: [[String: JointPoint]],
  homography: Homography,
  width: Double,
  height: Double
) -> [PlayerDetection] {
  var candidates: [PlayerDetection] = []
  for joints in rawPoses {
    var anchor: [(Double, Double)] = []
    for key in ["leftAnkle", "rightAnkle"] {
      if let j = joints[key], j.conf > AnalyzerParams.kptConf { anchor.append((j.x, j.y)) }
    }
    if anchor.isEmpty {
      // Ankles low-confidence: fall back to hips.
      for key in ["leftHip", "rightHip"] {
        if let j = joints[key], j.conf > AnalyzerParams.kptConf { anchor.append((j.x, j.y)) }
      }
    }
    guard !anchor.isEmpty else { continue }
    let ax = anchor.map { $0.0 }.reduce(0, +) / Double(anchor.count)
    let ay = anchor.map { $0.1 }.reduce(0, +) / Double(anchor.count)
    let projected = homography.project(ax / width, ay / height)
    guard projected.x >= Court.filterLoX, projected.x <= Court.filterHiX,
          projected.y >= Court.filterLoY, projected.y <= Court.filterHiY else { continue }
    let visible = joints.values.filter { $0.conf > AnalyzerParams.kptConf }
    guard visible.count >= AnalyzerParams.minVisibleJoints else { continue }
    let xs = visible.map { $0.x }
    let ys = visible.map { $0.y }
    guard let xMin = xs.min(), let xMax = xs.max(), let yMin = ys.min(), let yMax = ys.max() else {
      continue
    }
    let bboxW = xMax - xMin
    let bboxH = yMax - yMin
    candidates.append(PlayerDetection(
      joints: joints,
      court: (
        min(max(projected.x, 0), Court.width),
        min(max(projected.y, 0), Court.length)
      ),
      area: bboxW * bboxH,
      bboxH: bboxH
    ))
  }
  candidates.sort { $0.area > $1.area }
  return Array(candidates.prefix(2))
}

/// Port of TwoTracker: nearest-neighbour 2-ID association on court positions
/// with a swap guard (swap only when clearly better: swapCost < keepCost*0.7).
final class TwoTracker {
  private var pos: [String: (Double, Double)] = [:]

  func update(_ dets: [PlayerDetection]) -> [String: PlayerDetection] {
    var out: [String: PlayerDetection] = [:]
    guard !dets.isEmpty else { return out }
    if pos["A"] == nil && pos["B"] == nil {
      // First sight: leftmost player becomes A.
      let sorted = dets.sorted { $0.court.x < $1.court.x }
      out["A"] = sorted[0]
      if sorted.count > 1 { out["B"] = sorted[1] }
    } else if dets.count == 1 {
      let d = dets[0]
      out[dist("A", d) <= dist("B", d) ? "A" : "B"] = d
    } else {
      let d0 = dets[0]
      let d1 = dets[1]
      let keep = dist("A", d0) + dist("B", d1)
      let swap = dist("A", d1) + dist("B", d0)
      if swap < keep * 0.7 {
        out["A"] = d1
        out["B"] = d0
      } else {
        out["A"] = d0
        out["B"] = d1
      }
    }
    for (pid, d) in out {
      pos[pid] = (d.court.x, d.court.y)
    }
    return out
  }

  private func dist(_ pid: String, _ det: PlayerDetection) -> Double {
    guard let p = pos[pid] else { return 3.0 } // neutral prior
    return ((p.0 - det.court.x) * (p.0 - det.court.x)
      + (p.1 - det.court.y) * (p.1 - det.court.y)).squareRoot()
  }
}

// MARK: - Small math helpers

func cellOf(x: Double, y: Double) -> String {
  (y < Court.shortY ? "front" : "back") + (x < Court.midX ? "Left" : "Right")
}

/// numpy-style linear-interpolation percentile; p in 0..100.
func percentile(_ values: [Double], _ p: Double) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let rank = p / 100.0 * Double(sorted.count - 1)
  let lo = Int(rank.rounded(.down))
  let hi = Int(rank.rounded(.up))
  if lo == hi { return sorted[lo] }
  let frac = rank - Double(lo)
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

func median(_ values: [Double]) -> Double {
  percentile(values, 50)
}

func round1(_ x: Double) -> Double { (x * 10).rounded() / 10 }
func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }
func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }
func round4(_ x: Double) -> Double { (x * 10000).rounded() / 10000 }

/// searchsorted-left: first index whose value >= target.
func lowerBound(_ sorted: [Double], _ target: Double) -> Int {
  var lo = 0
  var hi = sorted.count
  while lo < hi {
    let mid = (lo + hi) / 2
    if sorted[mid] < target { lo = mid + 1 } else { hi = mid }
  }
  return lo
}

// MARK: - Striker attribution helpers (ports of analyze.py)

/// Peak scale-normalized wrist speed (bbox-heights/sec) in a frame window.
/// Real swings peak >= ~2, ball-bouncing / walking < ~1.9. Returns (peak, nObs).
func peakWristSpeed(
  trackFrames: [[String: PlayerDetection]],
  times: [Double],
  lo: Int,
  hi: Int,
  pid: String
) -> (peak: Double, obs: Int) {
  var best = 0.0
  var obs = 0
  var prev: [String: (x: Double, y: Double, t: Double)] = [:]
  guard lo <= hi else { return (0, 0) }
  for i in lo...hi {
    guard let d = trackFrames[i][pid] else { continue }
    for joint in ["leftWrist", "rightWrist"] {
      guard let j = d.joints[joint], j.conf > AnalyzerParams.kptConf else { continue }
      if let p = prev[joint] {
        let dt = times[i] - p.t
        if dt > 0 && dt < AnalyzerParams.wristSpeedMaxDt {
          let dx = j.x - p.x
          let dy = j.y - p.y
          let v = (dx * dx + dy * dy).squareRoot() / max(d.bboxH, 1.0) / dt
          best = max(best, v)
          obs += 1
        }
      }
      prev[joint] = (j.x, j.y, times[i])
    }
  }
  return (best, obs)
}

/// Total court-space ankle path length for a player over a frame window
/// (fallback signal when wrists are never seen).
func anklePathLength(
  trackFrames: [[String: PlayerDetection]],
  times _: [Double],
  lo: Int,
  hi: Int,
  pid: String
) -> Double {
  guard lo <= hi else { return 0 }
  var pts: [(Double, Double)] = []
  for i in lo...hi {
    if let d = trackFrames[i][pid] { pts.append((d.court.x, d.court.y)) }
  }
  guard pts.count >= 2 else { return 0 }
  var total = 0.0
  for k in 1..<pts.count {
    let dx = pts[k].0 - pts[k - 1].0
    let dy = pts[k].1 - pts[k - 1].1
    total += (dx * dx + dy * dy).squareRoot()
  }
  return total
}

/// Nearest sampled frame to time t in which pid was tracked, within maxDt.
func nearestTracked(
  trackFrames: [[String: PlayerDetection]],
  times: [Double],
  t: Double,
  pid: String,
  maxDt: Double = AnalyzerParams.nearestTrackedMaxDt
) -> Int? {
  var bestIdx: Int?
  var bestDt = maxDt
  for i in 0..<times.count {
    let dt = abs(times[i] - t)
    if dt < bestDt && trackFrames[i][pid] != nil {
      bestIdx = i
      bestDt = dt
    }
  }
  return bestIdx
}

/// No-audio fallback: onset times from peaks of max wrist speed across both
/// players (port of wrist_speed_onsets — keeps the FIRST peak in a merge run).
func wristSpeedOnsets(
  trackFrames: [[String: PlayerDetection]],
  times: [Double]
) -> [Double] {
  var speeds = [Double](repeating: 0, count: times.count)
  var prev: [String: (x: Double, y: Double, t: Double)] = [:]
  for i in 0..<trackFrames.count {
    var best = 0.0
    for pid in ["A", "B"] {
      guard let d = trackFrames[i][pid] else { continue }
      for joint in ["leftWrist", "rightWrist"] {
        guard let j = d.joints[joint], j.conf > AnalyzerParams.kptConf else { continue }
        let key = pid + "|" + joint
        if let p = prev[key] {
          let dt = max(times[i] - p.t, 1e-6)
          let dx = j.x - p.x
          let dy = j.y - p.y
          var v = (dx * dx + dy * dy).squareRoot() / dt
          v /= max(d.bboxH, 1.0) // scale-invariant
          best = max(best, v)
        }
        prev[key] = (j.x, j.y, times[i])
      }
    }
    speeds[i] = best
  }
  guard let maxSpeed = speeds.max(), maxSpeed > 0 else { return [] }
  let thr = max(percentile(speeds, 75), maxSpeed * 0.35)
  var onsets: [Double] = []
  guard speeds.count >= 3 else { return [] }
  for i in 1..<(speeds.count - 1) {
    if speeds[i] >= thr && speeds[i] >= speeds[i - 1] && speeds[i] >= speeds[i + 1] {
      let t = times[i]
      if let last = onsets.last, t - last < AnalyzerParams.onsetMergeS { continue }
      onsets.append(t)
    }
  }
  return onsets
}

// MARK: - Rallies

struct RawShot {
  let t: Double
  let pid: String
  let court: (x: Double, y: Double)
}

/// Split attributed shots into rallies on silence gaps > gap seconds; a rally
/// needs >= 2 shots (retrieval proxy needs a next shot).
func splitRallies(_ shots: [RawShot], gap: Double) -> [[RawShot]] {
  var rallies: [[RawShot]] = []
  var current: [RawShot] = []
  for s in shots {
    if let last = current.last, s.t - last.t > gap {
      rallies.append(current)
      current = []
    }
    current.append(s)
  }
  if !current.isEmpty { rallies.append(current) }
  return rallies.filter { $0.count >= 2 }
}

// MARK: - Predictability (entropy over the cell-transition matrix)

/// Port of entropy_predictability: 1 - H/Hmax over the first-order transition
/// matrix of a placement-cell sequence, plus the top pattern.
func entropyPredictability(_ cells: [String]) -> [String: Any] {
  let hMax = 2.0 // log2(4)
  struct Pair: Hashable { let a: String; let b: String }
  var trans: [Pair: Int] = [:]
  var order: [Pair] = [] // first-seen order, for deterministic tie-breaks
  for k in 1..<max(cells.count, 1) {
    let p = Pair(a: cells[k - 1], b: cells[k])
    if trans[p] == nil { order.append(p) }
    trans[p, default: 0] += 1
  }
  let n = trans.values.reduce(0, +)
  guard n > 0 else {
    return [
      "score": 0.0,
      "entropyBits": hMax,
      "maxEntropyBits": hMax,
      "topPattern": "insufficient data",
    ]
  }
  // Entropy rate: H = -sum_a pi_a sum_b P_ab log2 P_ab
  var rowTotals: [String: Int] = [:]
  for (pair, count) in trans {
    rowTotals[pair.a, default: 0] += count
  }
  var h = 0.0
  for (pair, count) in trans {
    let rowTotal = Double(rowTotals[pair.a] ?? count)
    let pRow = Double(count) / rowTotal
    h += (rowTotal / Double(n)) * (-pRow * log2(pRow))
  }
  var top = order[0]
  var topCount = trans[top] ?? 0
  for p in order where (trans[p] ?? 0) > topCount {
    top = p
    topCount = trans[p] ?? 0
  }
  let pct = Int((100.0 * Double(topCount) / Double(n)).rounded())
  return [
    "score": round3(1.0 - h / hMax),
    "entropyBits": round3(h),
    "maxEntropyBits": round3(hMax),
    "topPattern": "\(top.a) -> \(top.b) (\(pct)%)",
  ]
}

// MARK: - analysis.json builder

struct AnalysisInputs {
  var sourceName: String
  var durationSec: Double
  var fps: Double
  var width: Int
  var height: Int
  var sampleFps: Double
  var times: [Double]
  var trackFrames: [[String: PlayerDetection]]
  var onsets: [Double]
  var shotsRaw: [RawShot]
  var nGated: Int
  var audioAvailable: Bool
}

enum AnalysisBuildError: LocalizedError {
  case serializationFailed
  case contractViolation(String)

  var errorDescription: String? {
    switch self {
    case .serializationFailed:
      return "could not serialize analysis.json"
    case .contractViolation(let detail):
      return "analysis.json violates the schemaVersion 1 contract: \(detail)"
    }
  }
}

/// Assemble, validate and serialize the full analysis.json string.
func buildAnalysisJSON(_ inp: AnalysisInputs) throws -> String {
  var notes: [String] = []

  // Method notes (contract requirement: describe pose method, onset method,
  // rally gap used).
  notes.append(String(
    format: "on-device Vision pose (VNDetectHumanBodyPoseRequest), sampled at %.1f fps",
    inp.sampleFps
  ))
  if inp.audioAvailable {
    notes.append(String(
      format: "shot moments from audio RMS-energy onsets (%.0f ms hop, sliding median + %.0f*MAD threshold, %.2f s merge, player-activity gated)",
      AnalyzerParams.audioHopS * 1000, AnalyzerParams.onsetMadK, AnalyzerParams.onsetMergeS
    ))
  } else {
    notes.append("no audio track: shot moments from wrist-speed peaks (less reliable)")
  }
  notes.append(String(
    format: "rally split on silence gaps > %.1f s between attributed shots",
    AnalyzerParams.rallyGapS
  ))
  if inp.nGated > 0 {
    notes.append(
      "\(inp.nGated) audio onsets rejected by the player-activity gate "
        + "(likely neighbouring courts, voices or bounces)"
    )
  }

  // Rallies + retrieval-proxy placement: shot k lands where the striker of
  // shot k+1 (the opponent retrieving) stands.
  let rallies = splitRallies(inp.shotsRaw, gap: AnalyzerParams.rallyGapS)
  var shotsOut: [[String: Any]] = []
  var placements: [String: [String]] = ["A": [], "B": []]
  for rally in rallies {
    for k in 0..<(rally.count - 1) {
      let shot = rally[k]
      let next = rally[k + 1]
      let cell = cellOf(x: next.court.x, y: next.court.y)
      shotsOut.append(["tSec": round2(shot.t), "player": shot.pid, "cell": cell])
      placements[shot.pid, default: []].append(cell)
    }
  }
  let totalStrikes = rallies.reduce(0) { $0 + $1.count }
  if !inp.shotsRaw.isEmpty && rallies.isEmpty {
    notes.append("onsets detected but no rally had >= 2 attributed shots")
  }
  notes.append(
    "\(inp.onsets.count) onsets detected, \(inp.shotsRaw.count) attributed to a striker, "
      + "\(totalStrikes) inside rallies, \(shotsOut.count) placed via retrieval proxy"
  )

  // Per-player analytics.
  var players: [[String: Any]] = []
  for pid in ["A", "B"] {
    var heat = [Double](repeating: 0, count: Court.heatRows * Court.heatCols)
    var nPos = 0
    var nT = 0
    for frame in inp.trackFrames {
      guard let d = frame[pid] else { continue }
      let (x, y) = d.court
      let row = min(Int(y / Court.length * Double(Court.heatRows)), Court.heatRows - 1)
      let col = min(Int(x / Court.width * Double(Court.heatCols)), Court.heatCols - 1)
      heat[row * Court.heatCols + col] += 1
      nPos += 1
      let dx = x - Court.tX
      let dy = y - Court.tY
      if (dx * dx + dy * dy).squareRoot() <= Court.tRadius { nT += 1 }
    }
    if let peak = heat.max(), peak > 0 {
      heat = heat.map { round4($0 / peak) }
    }
    let cells = placements[pid] ?? []
    var placementCounts: [String: Any] = [:]
    for cell in ["frontLeft", "frontRight", "backLeft", "backRight"] {
      placementCounts[cell] = cells.filter { $0 == cell }.count
    }
    players.append([
      "id": pid,
      "label": "Player \(pid)",
      "shots": cells.count,
      "placement": placementCounts,
      "coverageHeatmap": [
        "rows": Court.heatRows,
        "cols": Court.heatCols,
        "values": heat,
      ],
      "tTimePct": round1(100.0 * Double(nT) / Double(max(nPos, 1))),
      "predictability": entropyPredictability(cells),
    ])
  }

  let rallyLens = rallies.map { $0.count }
  let framesAnalyzed = inp.times.count
  let bothCount = inp.trackFrames.filter { $0.count == 2 }.count
  let bothPct = round1(100.0 * Double(bothCount) / Double(max(framesAnalyzed, 1)))
  let avgShots = rallyLens.isEmpty
    ? 0.0
    : round2(Double(rallyLens.reduce(0, +)) / Double(rallyLens.count))

  let analysis: [String: Any] = [
    "schemaVersion": 1,
    "video": [
      "source": inp.sourceName,
      "license": "user footage",
      "durationSec": round2(inp.durationSec),
      "fps": round3(inp.fps),
      "width": inp.width,
      "height": inp.height,
    ],
    "court": ["gridRows": 2, "gridCols": 2],
    "players": players,
    "rallies": [
      "count": rallies.count,
      "avgShotsPerRally": avgShots,
      "longestRally": rallyLens.max() ?? 0,
    ],
    "shots": shotsOut,
    "quality": [
      "framesAnalyzed": framesAnalyzed,
      "bothPlayersDetectedPct": bothPct,
      "audioAvailable": inp.audioAvailable,
      "notes": notes,
    ],
  ]

  guard JSONSerialization.isValidJSONObject(analysis) else {
    throw AnalysisBuildError.serializationFailed
  }
  let data = try JSONSerialization.data(withJSONObject: analysis, options: [.sortedKeys])
  guard let json = String(data: data, encoding: .utf8) else {
    throw AnalysisBuildError.serializationFailed
  }
  try validateAnalysisShape(data)
  return json
}

/// Mirror of the load-bearing checks in src/features/analysis/types.ts
/// parseAnalysis — a shape this fails would parse to null in the app.
func validateAnalysisShape(_ data: Data) throws {
  func fail(_ detail: String) throws -> Never {
    throw AnalysisBuildError.contractViolation(detail)
  }
  guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    try fail("root is not an object")
  }
  guard root["schemaVersion"] as? Int == 1 else { try fail("schemaVersion != 1") }
  guard let video = root["video"] as? [String: Any],
        video["source"] is String, video["license"] is String,
        (video["durationSec"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        (video["fps"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        (video["width"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        (video["height"] as? NSNumber)?.doubleValue ?? -1 >= 0 else { try fail("video") }
  guard let court = root["court"] as? [String: Any],
        (court["gridRows"] as? NSNumber)?.intValue ?? 0 >= 1,
        (court["gridCols"] as? NSNumber)?.intValue ?? 0 >= 1 else { try fail("court") }
  guard let players = root["players"] as? [[String: Any]], !players.isEmpty else {
    try fail("players empty")
  }
  for player in players {
    guard let id = player["id"] as? String, id == "A" || id == "B" else { try fail("player id") }
    guard player["label"] is String else { try fail("player label") }
    guard (player["shots"] as? NSNumber)?.doubleValue ?? -1 >= 0 else { try fail("player shots") }
    guard let placement = player["placement"] as? [String: Any] else { try fail("placement") }
    for cell in ["frontLeft", "frontRight", "backLeft", "backRight"] {
      guard (placement[cell] as? NSNumber)?.doubleValue ?? -1 >= 0 else { try fail("placement \(cell)") }
    }
    guard let heatmap = player["coverageHeatmap"] as? [String: Any],
          let rows = (heatmap["rows"] as? NSNumber)?.intValue,
          let cols = (heatmap["cols"] as? NSNumber)?.intValue,
          rows >= 1, cols >= 1,
          let values = heatmap["values"] as? [NSNumber],
          values.count == rows * cols else { try fail("coverageHeatmap") }
    for v in values where !(v.doubleValue >= 0 && v.doubleValue <= 1) {
      try fail("heatmap value out of 0..1")
    }
    guard let tTime = (player["tTimePct"] as? NSNumber)?.doubleValue,
          tTime >= 0, tTime <= 100 else { try fail("tTimePct") }
    guard let pred = player["predictability"] as? [String: Any],
          let score = (pred["score"] as? NSNumber)?.doubleValue, score >= 0, score <= 1,
          (pred["entropyBits"] as? NSNumber)?.doubleValue ?? -1 >= 0,
          (pred["maxEntropyBits"] as? NSNumber)?.doubleValue ?? -1 >= 0,
          pred["topPattern"] is String else { try fail("predictability") }
  }
  guard let rallies = root["rallies"] as? [String: Any],
        (rallies["count"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        (rallies["avgShotsPerRally"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        (rallies["longestRally"] as? NSNumber)?.doubleValue ?? -1 >= 0 else { try fail("rallies") }
  guard let shots = root["shots"] as? [[String: Any]] else { try fail("shots") }
  for shot in shots {
    guard (shot["tSec"] as? NSNumber)?.doubleValue ?? -1 >= 0,
          let pid = shot["player"] as? String, pid == "A" || pid == "B",
          let cell = shot["cell"] as? String,
          ["frontLeft", "frontRight", "backLeft", "backRight"].contains(cell) else {
      try fail("shot event")
    }
  }
  guard let quality = root["quality"] as? [String: Any],
        (quality["framesAnalyzed"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        let both = (quality["bothPlayersDetectedPct"] as? NSNumber)?.doubleValue,
        both >= 0, both <= 100,
        quality["audioAvailable"] is Bool || quality["audioAvailable"] as? NSNumber != nil,
        quality["notes"] is [String] else { try fail("quality") }
}
