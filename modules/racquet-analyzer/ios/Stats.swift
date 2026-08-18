// Stats.swift — pure-Foundation port of analyze.py's tracking + analytics:
// court geometry, the two-player appearance+position re-identification tracker,
// striker attribution helpers, rally split, retrieval-proxy placement,
// 12x8 coverage heatmap, T-time, transition-entropy predictability, shot-type
// classification, the COCO-17 keypoint track writer, and the analysis.json
// (schemaVersion 2) builder + shape validator.
//
// No AVFoundation/Vision/Expo imports so the whole file compiles standalone
// for off-device unit checks (see the scratchpad check harness). The one part
// that needs real pixels — reading the torso patch out of a CVPixelBuffer —
// lives in Appearance.swift; everything here works on numbers already sampled.

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
  // Rally-activity gate (see rallyActivity). The cut is a percentile of the
  // clip's OWN activity distribution, not an absolute number: activity is
  // measured in bbox-heights/sec, so its scale moves with camera framing and
  // player distance. Absolute thresholds picked on two of the three archive
  // clips gave held-out recall 0.60; the percentile form gave 0.73 under the
  // same protocol. Do not hard-code one clip's q65 here.
  static let rallyWinS = 1.5 // RALLY_WIN_S, half-width of the activity window
  static let rallyActQ = 65.0 // RALLY_ACT_Q, keep onsets in the busiest 35%
  static let rallyMinObs = 3 // RALLY_MIN_OBS, wrist samples before a median counts
  static let strongSwingF = 1.2 // STRONG_SWING_F x the clip's p90 swing peak
  static let minVisibleJoints = 6 // detect_players len(vis) >= 6
  static let audioSampleRate = 22050.0
  static let audioHopS = 0.010 // ~10 ms hop
  static let audioWinS = 0.020 // 20 ms RMS window
  static let onsetMadK = 3.0 // adaptive threshold: median + k*MAD
  static let onsetMedianHalfWinS = 1.0 // sliding-window half width for median/MAD
}

/// Appearance re-identification — the shared spec with analysis/analyze.py.
/// Every constant here is the Swift spelling of the identically-named Python
/// constant; the two engines must produce the same identities on the same
/// footage, so these must not drift.
enum AppearanceParams {
  // Torso patch geometry, in units of the subject's own torso length, so the
  // patch shrinks with distance instead of swallowing the background at the
  // back wall.
  static let centerF = 0.45 // APP_CENTER_F: patch centre, shoulders -> hips
  static let halfHF = 0.34 // APP_HALF_H_F: half-height = this x torso length
  static let halfWF = 0.36 // APP_HALF_W_F: half-width = this x shoulder width
  static let minShoulderWF = 0.35 // APP_MIN_SHO_W_F: shoulders seen edge-on collapse
  // to ~0 px wide; floor the width at this x torso length so the patch never degenerates
  static let minTorsoPx = 8.0 // APP_MIN_TORSO_PX
  static let minPixels = 24 // APP_MIN_PIXELS: clipped patch must hold this many pixels
  static let minInside = 0.5 // APP_MIN_INSIDE: ... and this fraction of its unclipped area

  // Descriptor = (r, g, L): rg-chromaticity of the patch median plus its luma
  // relative to the frame's own exposure. The weights are 1 / the within-person
  // spread of each component, averaged over the three audit clips
  // (analysis/tools/identity_audit.py --calibrate). For two classes with roughly
  // diagonal covariance, standardising this way makes plain Euclidean distance
  // the right discriminant. Both halves earn their place: luma usually carries
  // the most (per-clip separability 5.1 / 1.6 / 6.3) because these players wear
  // dark navy against white, but on the clip where luma is weakest, chroma r is
  // the strongest single component (2.1 against luma's 1.6).
  static let chromaW = 32.0 // APP_CHROMA_W
  static let lumaW = 2.6 // APP_LUMA_W

  /// APP_LAMBDA: appearance weight in the association cost. Swept against an
  /// oracle-primed association test over all three audit clips: re-acquisition
  /// error after an occlusion gap falls from 15.5% at lambda=0 to a flat
  /// 2.2-2.7% plateau spanning 0.2-1.5, while adjacent frames stay at 1 error
  /// in 4365. 0.5 is the centre of that plateau rather than the grid minimum
  /// (0.35, better by 2 decisions in 1018 — noise), so the value does not
  /// depend on where the grid was sampled.
  static let lambda = 0.5
  static let emaAlpha = 0.05 // APP_EMA_ALPHA: ~20 samples (2.5 s) time constant
  static let separationMinM = 1.2 // APP_SEP_MIN_M: players this far apart to trust identity
  static let boxOverlapMax = 0.15 // APP_BOX_OVERLAP_MAX: ... and boxes may not overlap more
  static let marginMin = 0.35 // APP_MARGIN_MIN: ... and keep/swap must be this decisive
  static let learnMargin = 0.0 // APP_LEARN_MARGIN: ... and the detection must already
  // look more like the template it is about to update than like the other one
}

/// Position half of the association cost.
enum PositionParams {
  static let scaleM = 0.75 // POS_SCALE_M: metres of plausible motion between samples at 8 fps
  static let speedMS = 3.0 // POS_SPEED_MS: uncertainty growth while an identity is unseen
  static let neutral = 3.0 // POS_NEUTRAL: charged against an identity with no known position
}

/// schema v2 shot classification. The app, the Python engine and this engine
/// all implement the same thresholds, so these must not drift.
enum ShotClass {
  static let trackHz = 8.0 // TRACK_HZ: keypoint sampling rate written to `tracks`
  static let frontThirdY = 3.25 // FRONT_THIRD_Y: landing this far up = front-court shot
  static let deepY = 6.5 // DEEP_Y: landing/striking behind this = back third
  static let poseConfLow = 0.25 // POSE_CONF_LOW: below this the court fix is only rough.
  // Calibrated to the ankle-score distribution the pose stage actually produces
  // (median ~0.35); the old 0.5 sat above p75 and flagged nearly every shot,
  // which made typeConfidence a constant carrying no signal.
  static let baseConfidence = 0.8 // SHOT_BASE_CONF
  static let lowPosePenalty = 0.5 // multiplier when either end came from a rough fix
}

/// COCO-17 order, expressed in the Vision joint names Pose.swift emits. Vision
/// carries a few joints COCO does not (neck, root) and may drop any joint it
/// cannot see; the track writer emits conf 0 for a missing slot rather than
/// inventing a position.
let cocoJointOrder: [String] = [
  "nose", "leftEye", "rightEye", "leftEar", "rightEar",
  "leftShoulder", "rightShoulder", "leftElbow", "rightElbow",
  "leftWrist", "rightWrist", "leftHip", "rightHip",
  "leftKnee", "rightKnee", "leftAnkle", "rightAnkle",
]

// MARK: - Detections and tracking

struct JointPoint {
  var x: Double // upright image pixels (y down)
  var y: Double
  var conf: Double
}

/// One detection's shirt, as three numbers.
///
/// `r` and `g` are the rg-chromaticity of the torso patch's per-channel median,
/// which is invariant to how brightly that patch happens to be lit. `l` is the
/// log of the patch luma over the frame's own median grey, so a camera
/// auto-exposure step moves every player equally and cancels.
struct Appearance: Equatable {
  var r: Double
  var g: Double
  var l: Double
}

/// Weighted Euclidean distance between two descriptors (appearance_distance).
func appearanceDistance(_ u: Appearance, _ v: Appearance) -> Double {
  let dr = AppearanceParams.chromaW * (u.r - v.r)
  let dg = AppearanceParams.chromaW * (u.g - v.g)
  let dl = AppearanceParams.lumaW * (u.l - v.l)
  return (dr * dr + dg * dg + dl * dl).squareRoot()
}

/// Axis-aligned pixel rect, half-open in both axes: x0..<x1, y0..<y1.
struct PixelRect: Equatable {
  var x0: Int
  var y0: Int
  var x1: Int
  var y1: Int
  var width: Int { x1 - x0 }
  var height: Int { y1 - y0 }
}

/// Pixel bounding box over confidently-placed keypoints — analyze.py's
/// keypoint_box. detectPlayers builds it from the same visible-joint set the
/// detection's `area` comes from, so the two can never disagree.
struct BBox: Equatable {
  var minX: Double
  var minY: Double
  var maxX: Double
  var maxY: Double
  var area: Double { max(maxX - minX, 0) * max(maxY - minY, 0) }
  var height: Double { max(maxY - minY, 0) }
}

/// Port of box_overlap: intersection area over the SMALLER box's area, 0 when
/// either box is missing.
///
/// Overlap-over-min rather than IoU because the question is "is one player in
/// front of the other", and a small player fully in front of a large one has a
/// low IoU but an overlap of 1.
func boxOverlap(_ a: BBox?, _ b: BBox?) -> Double {
  guard let a, let b else { return 0 }
  let ix = max(0, min(a.maxX, b.maxX) - max(a.minX, b.minX))
  let iy = max(0, min(a.maxY, b.maxY) - max(a.minY, b.minY))
  let smaller = min(a.area, b.area)
  return smaller > 0 ? (ix * iy) / smaller : 0
}

/// Port of torso_patch_box: the axis-aligned patch of shirt to sample, clipped
/// to the frame, or nil when it cannot be trusted.
///
/// Sized from the subject's own torso, so a player at the back wall and the
/// same player at the front wall yield patches covering the same piece of
/// shirt. `scaleX`/`scaleY` map the joint coordinate space onto the pixel
/// buffer's own resolution; they are 1 whenever the two agree.
func torsoPatchBox(
  joints: [String: JointPoint],
  width: Int,
  height: Int,
  scaleX: Double = 1,
  scaleY: Double = 1
) -> PixelRect? {
  func torsoJoint(_ name: String) -> (x: Double, y: Double)? {
    guard let j = joints[name], j.conf > AnalyzerParams.kptConf else { return nil }
    return (j.x * scaleX, j.y * scaleY)
  }
  // Any of the four torso corners missing and there is no patch to speak of.
  guard let lSho = torsoJoint("leftShoulder"), let rSho = torsoJoint("rightShoulder"),
        let lHip = torsoJoint("leftHip"), let rHip = torsoJoint("rightHip") else { return nil }

  let shoX = 0.5 * (lSho.x + rSho.x)
  let shoY = 0.5 * (lSho.y + rSho.y)
  let hipX = 0.5 * (lHip.x + rHip.x)
  let hipY = 0.5 * (lHip.y + rHip.y)
  let torsoLen = ((hipX - shoX) * (hipX - shoX) + (hipY - shoY) * (hipY - shoY)).squareRoot()
  guard torsoLen >= AppearanceParams.minTorsoPx else { return nil }

  let cx = shoX + AppearanceParams.centerF * (hipX - shoX)
  let cy = shoY + AppearanceParams.centerF * (hipY - shoY)
  let shoDX = lSho.x - rSho.x
  let shoDY = lSho.y - rSho.y
  let shoW = (shoDX * shoDX + shoDY * shoDY).squareRoot()
  let halfW = AppearanceParams.halfWF * max(shoW, AppearanceParams.minShoulderWF * torsoLen)
  let halfH = AppearanceParams.halfHF * torsoLen

  // Python rounds half-to-even (int(round(x))); match it so the two engines
  // pick the same pixels on the same footage.
  func r2i(_ v: Double) -> Int {
    guard v.isFinite else { return 0 }
    return Int(v.rounded(.toNearestOrEven))
  }
  var x0 = r2i(cx - halfW)
  var x1 = r2i(cx + halfW)
  var y0 = r2i(cy - halfH)
  var y1 = r2i(cy + halfH)
  // Unclipped area, measured BEFORE clipping: it is the denominator that says
  // how much of the intended patch actually landed on the frame.
  let full = max((x1 - x0) * (y1 - y0), 1)
  x0 = max(0, x0)
  y0 = max(0, y0)
  x1 = min(width, x1)
  y1 = min(height, y1)
  guard x1 > x0, y1 > y0 else { return nil }
  let inside = (x1 - x0) * (y1 - y0)
  // A patch mostly off-frame describes the frame edge, not the player.
  guard inside >= AppearanceParams.minPixels,
        Double(inside) >= AppearanceParams.minInside * Double(full) else { return nil }
  return PixelRect(x0: x0, y0: y0, x1: x1, y1: y1)
}

/// Build the descriptor from a patch's per-channel medians (0-255) and the
/// frame's exposure reference. Port of the tail of torso_appearance.
func appearanceFromMedians(
  b: Double, g: Double, r: Double, exposureRef: Double
) -> Appearance? {
  let total = b + g + r
  guard total >= 1e-6 else { return nil } // a pure-black patch has no chromaticity
  let lum = total / 3.0
  return Appearance(
    r: r / total,
    g: g / total,
    l: log((lum + 1.0) / (max(exposureRef, 0.0) + 1.0))
  )
}

struct PlayerDetection {
  var joints: [String: JointPoint]
  var court: (x: Double, y: Double) // meters, clamped into court bounds
  var area: Double
  var bboxH: Double
  /// The court fix is only as good as the joints it was projected from: mean
  /// confidence of the anchor (ankles, or the hip fallback). Drives the
  /// shot-type confidence discount, nothing upstream.
  var posConf: Double = 0
  /// Shirt descriptor, nil when the torso patch could not be read (low-confidence
  /// keypoints, patch off-frame, player too small). The tracker degrades to
  /// position-only for that frame rather than guessing.
  var app: Appearance?
  /// Visible-keypoint pixel box, used only to tell "in front of" from "beside".
  var box: BBox?
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
    var anchor: [JointPoint] = []
    for key in ["leftAnkle", "rightAnkle"] {
      if let j = joints[key], j.conf > AnalyzerParams.kptConf { anchor.append(j) }
    }
    if anchor.isEmpty {
      // Ankles low-confidence: fall back to hips.
      for key in ["leftHip", "rightHip"] {
        if let j = joints[key], j.conf > AnalyzerParams.kptConf { anchor.append(j) }
      }
    }
    guard !anchor.isEmpty else { continue }
    let ax = anchor.map { $0.x }.reduce(0, +) / Double(anchor.count)
    let ay = anchor.map { $0.y }.reduce(0, +) / Double(anchor.count)
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
    // One box, used three ways: the size that ranks candidates, the height that
    // normalises wrist speed, and the overlap test that tells "in front of"
    // from "beside". This is keypoint_box by construction — the same visible
    // set, and >= 6 joints are visible here where keypoint_box needs 2.
    let box = BBox(minX: xMin, minY: yMin, maxX: xMax, maxY: yMax)
    candidates.append(PlayerDetection(
      joints: joints,
      court: (
        min(max(projected.x, 0), Court.width),
        min(max(projected.y, 0), Court.length)
      ),
      area: box.area,
      bboxH: box.height,
      posConf: anchor.map { $0.conf }.reduce(0, +) / Double(anchor.count),
      app: nil, // filled by TorsoAppearanceSampler while the frame is still in hand
      box: box
    ))
  }
  candidates.sort { $0.area > $1.area }
  return Array(candidates.prefix(2))
}

/// Port of TwoTracker: 2-ID association by TOTAL cost over both pairings —
/// normalised court distance + APP_LAMBDA x appearance distance to a
/// per-identity template.
///
/// Position alone is a coin flip exactly when it matters — the moment two
/// players cross or occlude each other — and a wrong call there persists,
/// because the next frame's position prior now agrees with the mistake. The
/// shirt does not become ambiguous during a crossing, so appearance is what
/// breaks the tie. Templates are learned only on frames where identity is not
/// in doubt, so an ambiguous overlap can never teach a template the wrong
/// player and make the swap permanent.
///
/// There is deliberately no `swap < keep * 0.7` guard any more: comparing the
/// two total costs is the decision, and an arbitrary multiplier on top of it
/// only biases which coin flip wins.
final class TwoTracker {
  private var pos: [String: (x: Double, y: Double)] = [:]
  private var seenT: [String: Double] = [:] // time of that position fix
  private var tmpl: [String: Appearance] = [:] // EMA appearance template

  private static let ids = ["A", "B"]
  private static func other(_ pid: String) -> String { pid == "A" ? "B" : "A" }

  func update(_ dets: [PlayerDetection], t: Double) -> [String: PlayerDetection] {
    var out: [String: PlayerDetection] = [:]
    guard !dets.isEmpty else { return out }

    if pos["A"] == nil && pos["B"] == nil {
      // First sight: leftmost player becomes A (unchanged convention). At most
      // two detections arrive, so an explicit compare beats a sort and keeps
      // the area order as the tie-break, exactly as Python's stable sort does.
      let ordered = (dets.count > 1 && dets[1].court.x < dets[0].court.x)
        ? [dets[1], dets[0]]
        : dets
      out["A"] = ordered[0]
      if ordered.count > 1 { out["B"] = ordered[1] }
      // Nothing to protect yet: at first sight the leftmost convention *defines*
      // which player is A, so these descriptors cannot be the wrong ones.
      if let a = out["A"], let b = out["B"], unoccluded(a, b),
         let aApp = a.app, let bApp = b.app {
        tmpl["A"] = aApp
        tmpl["B"] = bApp
      }
    } else if dets.count == 1 {
      let d = dets[0]
      // Appearance only helps here if it can speak about both identities.
      let useApp = d.app != nil && tmpl["A"] != nil && tmpl["B"] != nil
      let ca = cost("A", d, t, useApp)
      let cb = cost("B", d, t, useApp)
      out[ca <= cb ? "A" : "B"] = d
      // and no learning: one detection never proves who the other one is.
    } else {
      let d0 = dets[0]
      let d1 = dets[1]
      // Include the appearance term only where it is symmetric across the two
      // pairings. With two templates it compares one detection against both
      // identities; with two descriptors it compares one identity against both
      // detections. With one of each the term would land in `keep` and not in
      // `swap`, which is a bias, not evidence.
      let useApp = (d0.app != nil && d1.app != nil)
        || (tmpl["A"] != nil && tmpl["B"] != nil)
      let keep = cost("A", d0, t, useApp) + cost("B", d1, t, useApp)
      let swap = cost("A", d1, t, useApp) + cost("B", d0, t, useApp)
      if swap < keep {
        out["A"] = d1
        out["B"] = d0
      } else {
        out["A"] = d0
        out["B"] = d1
      }
      if let a = out["A"], let b = out["B"],
         abs(keep - swap) >= AppearanceParams.marginMin, unoccluded(a, b) {
        learn(out)
      }
    }

    for (pid, d) in out {
      pos[pid] = d.court
      seenT[pid] = t
    }
    return out
  }

  /// Is this a frame where the two detections are unambiguously two people?
  private func unoccluded(_ da: PlayerDetection, _ db: PlayerDetection) -> Bool {
    guard da.app != nil, db.app != nil else { return false }
    let dx = da.court.x - db.court.x
    let dy = da.court.y - db.court.y
    guard (dx * dx + dy * dy).squareRoot() >= AppearanceParams.separationMinM else {
      return false
    }
    return boxOverlap(da.box, db.box) <= AppearanceParams.boxOverlapMax
  }

  /// EMA the templates towards this frame — but only if appearance already
  /// agrees with the assignment.
  ///
  /// Being unoccluded says the two detections are two different people; it does
  /// not say the labels are on the right ones. If the tracker is running
  /// swapped, every frame after the swap looks perfectly clean, and a template
  /// that learns from those frames walks onto the other player within a couple
  /// of seconds and makes the swap permanent — the exact failure this whole
  /// change exists to remove. So a detection may only teach a template it
  /// already resembles more than it resembles the other one; when the labels
  /// are wrong the templates simply stop learning, stay correct, and go on
  /// voting to swap back at the next re-acquisition.
  ///
  /// A then B, in that order: B is compared against a template A may have just
  /// moved, which is what the Python reference does.
  private func learn(_ out: [String: PlayerDetection]) {
    for pid in Self.ids {
      guard let det = out[pid], let app = det.app else { continue }
      guard let mine = tmpl[pid] else {
        tmpl[pid] = app // initialise
        continue
      }
      if let theirs = tmpl[Self.other(pid)],
         appearanceDistance(app, mine) + AppearanceParams.learnMargin
         > appearanceDistance(app, theirs) {
        continue // appearance disagrees with the label: refuse to learn
      }
      let a = AppearanceParams.emaAlpha
      tmpl[pid] = Appearance(
        r: (1 - a) * mine.r + a * app.r,
        g: (1 - a) * mine.g + a * app.g,
        l: (1 - a) * mine.l + a * app.l
      )
    }
  }

  private func cost(
    _ pid: String, _ det: PlayerDetection, _ t: Double, _ useApp: Bool
  ) -> Double {
    var c = positionCost(pid, det, t)
    if useApp, let app = det.app, let template = tmpl[pid] {
      c += AppearanceParams.lambda * appearanceDistance(app, template)
    }
    return c
  }

  /// Court distance in units of how far this identity could plausibly have
  /// moved since it was last seen — a 2 m jump is damning after 1/8 s and
  /// meaningless after 4 s of being lost behind the other player.
  private func positionCost(_ pid: String, _ det: PlayerDetection, _ t: Double) -> Double {
    guard let p = pos[pid] else { return PositionParams.neutral }
    let gap = seenT[pid].map { max(0, t - $0) } ?? 0
    let dx = p.x - det.court.x
    let dy = p.y - det.court.y
    return (dx * dx + dy * dy).squareRoot()
      / (PositionParams.scaleM + PositionParams.speedMS * gap)
  }

  // MARK: Introspection (checks only)

  /// The learned templates, for the off-device harness. Not used by the pipeline.
  var templates: [String: Appearance] { tmpl }
}

// MARK: - Small math helpers

func cellOf(x: Double, y: Double) -> String {
  (y < Court.shortY ? "front" : "back") + (x < Court.midX ? "Left" : "Right")
}

/// numpy-style linear-interpolation percentile; p in 0..100.
///
/// The interpolation is written as `v[f] + frac*(v[f+1] - v[f])`, which is
/// np.percentile's own arithmetic: the algebraically identical
/// `v[f]*(1-frac) + v[f+1]*frac` lands one ulp away on real data, and the
/// rally gate compares activity against a percentile OF that activity, so a
/// frame sitting exactly on the threshold would be gated by one engine and
/// kept by the other.
func percentile(_ values: [Double], _ p: Double) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let rank = p / 100.0 * Double(sorted.count - 1)
  let lo = Int(rank.rounded(.down))
  let hi = min(lo + 1, sorted.count - 1)
  return sorted[lo] + (rank - Double(lo)) * (sorted[hi] - sorted[lo])
}

/// np.median: the middle element, or the mean of the two middle ones. Not
/// percentile(_, 50) — the interpolated form is a different rounding of the
/// same number, and rallyActivity takes a median per player per frame.
func median(_ values: [Double]) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let mid = sorted.count / 2
  return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
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

func clamp01(_ x: Double) -> Double { min(max(x, 0), 1) }

/// np.sign of the offset from the half-court line: which side of the court a
/// point sits on, 0 exactly on the line.
func halfSign(_ x: Double) -> Double {
  let d = x - Court.midX
  return d > 0 ? 1 : (d < 0 ? -1 : 0)
}

/// Shortest JSON number for a value already rounded to 3 decimals; integral
/// values lose their ".0". Non-finite degrades to 0 — `nan` is not JSON, and a
/// single bad keypoint must not poison the whole file.
func compactNumber(_ x: Double) -> String {
  guard x.isFinite else { return "0" }
  let r = round3(x)
  if r == r.rounded() && abs(r) < 1e15 { return String(Int(r)) }
  return String(r)
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

/// Per-pose-frame scale-normalized wrist speed for each player — the same
/// measurement peakWristSpeed makes, kept as a time series instead of a window
/// maximum. NaN where no wrist speed could be measured on that frame.
///
/// Port of wrist_speed_frames. The per-joint previous observation persists
/// across the WHOLE clip and is not reset when the player goes untracked, and
/// it is updated whenever the joint is confident — even when the dt test
/// rejects the pair — exactly as the Python reference does.
func wristSpeedFrames(
  trackFrames: [[String: PlayerDetection]],
  times: [Double]
) -> [String: [Double]] {
  var out: [String: [Double]] = [:]
  for pid in ["A", "B"] {
    var prev: [String: (x: Double, y: Double, t: Double)] = [:]
    var vals = [Double](repeating: Double.nan, count: times.count)
    for i in 0..<times.count {
      guard let d = trackFrames[i][pid] else { continue } // stays NaN; prev untouched
      var best = Double.nan
      for joint in ["leftWrist", "rightWrist"] {
        guard let j = d.joints[joint], j.conf > AnalyzerParams.kptConf else { continue }
        if let p = prev[joint] {
          let dt = times[i] - p.t
          if dt > 0 && dt < AnalyzerParams.wristSpeedMaxDt {
            let dx = j.x - p.x
            let dy = j.y - p.y
            let v = (dx * dx + dy * dy).squareRoot() / max(d.bboxH, 1.0) / dt
            best = best.isNaN ? v : max(best, v)
          }
        }
        prev[joint] = (j.x, j.y, times[i])
      }
      vals[i] = best
    }
    out[pid] = vals
  }
  return out
}

/// How hard BOTH players are working, per pose frame.
///
/// Port of rally_activity. An audio onset is only a shot on THIS court if
/// somebody here is playing a rally. Between points the players drift, bounce
/// the ball and walk, while the microphone keeps hearing racquet strikes from
/// neighbouring courts — which is what the wrist-peak gate cannot reject,
/// because those onsets sit next to a player whose arm happens to be moving.
///
/// Sustained two-player effort separates the two states far better than any
/// instantaneous swing measure: the statistic is the median wrist speed over
/// +/-rallyWinS for each player, then the MINIMUM over the two, so one player
/// pacing about while the other stands still does not qualify. A player who is
/// untracked across the whole window is ignored rather than scored zero, so a
/// tracking dropout cannot veto a real rally.
func rallyActivity(
  trackFrames: [[String: PlayerDetection]],
  times: [Double]
) -> [Double] {
  let per = wristSpeedFrames(trackFrames: trackFrames, times: times)
  var act = [Double](repeating: 0, count: times.count)
  for i in 0..<times.count {
    // Half-open [lo, hi), matching numpy searchsorted on both ends.
    let lo = lowerBound(times, times[i] - AnalyzerParams.rallyWinS)
    let hi = lowerBound(times, times[i] + AnalyzerParams.rallyWinS)
    var seen: [Double] = []
    for pid in ["A", "B"] {
      guard let w = per[pid], lo < hi else { continue }
      var s: [Double] = []
      s.reserveCapacity(hi - lo)
      for k in lo..<hi where !w[k].isNaN { s.append(w[k]) }
      if s.count >= AnalyzerParams.rallyMinObs { seen.append(median(s)) }
    }
    act[i] = seen.isEmpty ? 0.0 : (seen.count == 2 ? min(seen[0], seen[1]) : seen[0])
  }
  return act
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
  /// Wrist above the shoulder line at contact — the volley tell.
  var highContact: Bool = false
  /// The striker's pose at contact was too weak to trust the court fix.
  var lowConfidence: Bool = false
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

// MARK: - Shot classification (schema v2)

struct ShotClassification {
  let type: String
  let confidence: Double
}

/// Did the striker meet the ball above the shoulder? — the volley signature.
///
/// Image y grows downward, so "above" is the smaller y. Only the higher of the
/// two wrists matters; a shoulder hidden behind the body falls back to the
/// other one, which is close enough for an above/below test.
func isHighContact(_ joints: [String: JointPoint]) -> Bool {
  func confident(_ name: String) -> JointPoint? {
    guard let j = joints[name], j.conf >= AnalyzerParams.kptConf else { return nil }
    return j
  }
  var pair: (wrist: JointPoint, shoulder: String)?
  for (wristName, shoulderName) in [
    ("leftWrist", "leftShoulder"), ("rightWrist", "rightShoulder"),
  ] {
    guard let wrist = confident(wristName) else { continue }
    if let pair, pair.wrist.y <= wrist.y { continue }
    pair = (wrist, shoulderName)
  }
  guard let pair else { return false }
  let other = pair.shoulder == "leftShoulder" ? "rightShoulder" : "leftShoulder"
  guard let shoulder = confident(pair.shoulder) ?? confident(other) else { return false }
  return pair.wrist.y < shoulder.y
}

/// Shot type from striker position, where the ball ended up (the retrieval
/// proxy: the striker of the next shot), and the contact height.
///
/// There is deliberately no "lob" class: without ball tracking a lob and a
/// drive are the same observation, and a confidently wrong label is worse than
/// none — anything the geometry cannot separate stays "unknown" at confidence 0.
func classifyShot(
  isFirstOfRally: Bool,
  highContact: Bool,
  striker: (x: Double, y: Double),
  land: (x: Double, y: Double)?,
  lowConfidencePose: Bool
) -> ShotClassification {
  func labelled(_ type: String) -> ShotClassification {
    let raw = lowConfidencePose
      ? ShotClass.baseConfidence * ShotClass.lowPosePenalty
      : ShotClass.baseConfidence
    return ShotClassification(type: type, confidence: clamp01(raw))
  }
  let unknown = ShotClassification(type: "unknown", confidence: 0)

  if isFirstOfRally { return labelled("serve") }
  guard let land else { return unknown } // rally ended: nothing to infer from
  if highContact { return labelled("volley") }
  if land.y < ShotClass.frontThirdY {
    // Only a shot struck from the back that crosses the court reads as a boast;
    // straight from the back or anything from mid-court is a drop.
    let fromBack = striker.y > ShotClass.deepY
    let crossed = halfSign(striker.x) != halfSign(land.x)
    return labelled(fromBack && crossed ? "boast" : "drop")
  }
  guard halfSign(striker.x) != 0, halfSign(land.x) != 0 else {
    // dead on the half-court line: the side that separates a drive from a
    // cross-court is exactly what cannot be read here
    return unknown
  }
  // Past the front third, depth no longer changes the name — a ball driven to
  // mid-court is still a drive — so the side alone decides. Testing only
  // land.y > deepY left ~46% of shots unlabelled on well-calibrated footage,
  // because retrieval positions cluster in the band that test excluded.
  return labelled(halfSign(striker.x) == halfSign(land.x) ? "drive" : "crossCourt")
}

// MARK: - Keypoint tracks (schema v2)

/// Streams the `tracks` array straight into compact JSON text.
///
/// A 6-minute match is ~2900 samples x 2 players x 51 numbers; held as
/// Foundation objects until the end that costs an order of magnitude more
/// memory than the text it serializes to, and the phone is doing this while
/// decoding video. Nothing is retained past the sample being written.
final class TrackWriter {
  private var body = "["
  private var needsSeparator = false
  private let minInterval: Double
  private var lastT = -Double.greatestFiniteMagnitude
  private(set) var sampleCount = 0

  /// `hz` caps the emitted rate: the decode pass may sample faster, but the
  /// overlay does not need it and the file lives on the user's phone.
  init(hz: Double = ShotClass.trackHz) {
    minInterval = hz > 0 ? 1.0 / hz : 0
    body.reserveCapacity(1 << 16)
  }

  /// One sample. Frames where neither player was detected are dropped: a
  /// sample with an empty `p` is pure overhead in a file the phone keeps.
  func append(t: Double, players: [String: PlayerDetection], width: Double, height: Double) {
    guard t.isFinite, t >= 0, width > 0, height > 0 else { return }
    // The decoder targets sampleFps but lands wherever the source fps divides
    // (a 25 fps source sampled at 8 gives 0.12 s steps), so decimate only when
    // it overshoots by a real margin — a strict compare would halve the rate.
    guard t >= lastT + minInterval * 0.75 else { return }
    let present = ["A", "B"].compactMap { pid in players[pid].map { (pid, $0) } }
    guard !present.isEmpty else { return }
    lastT = t
    sampleCount += 1
    if needsSeparator { body += "," }
    needsSeparator = true
    body += "{\"t\":\(compactNumber(t)),\"p\":["
    for (i, entry) in present.enumerated() {
      if i > 0 { body += "," }
      appendPlayer(pid: entry.0, det: entry.1, width: width, height: height)
    }
    body += "]}"
  }

  private func appendPlayer(pid: String, det: PlayerDetection, width: Double, height: Double) {
    body += "{\"id\":\"\(pid)\",\"k\":["
    for (i, name) in cocoJointOrder.enumerated() {
      if i > 0 { body += "," }
      guard let j = det.joints[name], j.conf > 0, j.x.isFinite, j.y.isFinite else {
        body += "0,0,0"
        continue
      }
      // Vision extrapolates joints a little past the frame edge; clamping keeps
      // the overlay inside the video rect instead of drawing into the letterbox.
      body += compactNumber(clamp01(j.x / width))
      body += ","
      body += compactNumber(clamp01(j.y / height))
      body += ","
      body += compactNumber(clamp01(j.conf))
    }
    body += "]}"
  }

  /// The finished JSON array, handed over and released — nil when nothing was
  /// sampled, so the field is simply omitted and the app degrades to no
  /// skeleton. Consumes the writer.
  func takeJSON() -> String? {
    guard sampleCount > 0 else { return nil }
    body += "]"
    defer {
      body = "["
      needsSeparator = false
      sampleCount = 0
    }
    return body
  }
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
  /// Onsets that survived the swing gate but landed between points, with no
  /// rally in progress on this court (see rallyActivity).
  var nRallyGated: Int = 0
  var audioAvailable: Bool
  /// Pre-serialized `tracks` array (see TrackWriter); nil emits no field.
  var tracksJSON: String?
  var trackSamples: Int = 0
  /// Appearance re-identification coverage, reported in `quality.notes`. If the
  /// torso patch could never be read the tracker silently falls back to
  /// position-only — which is the failure mode this whole path exists to
  /// remove — so it says so rather than looking healthy.
  var appearanceDescribed: Int = 0
  var appearanceAttempted: Int = 0
  var appearanceUnsupportedFrames: Int = 0
}

enum AnalysisBuildError: LocalizedError {
  case serializationFailed
  case contractViolation(String)

  var errorDescription: String? {
    switch self {
    case .serializationFailed:
      return "could not serialize analysis.json"
    case .contractViolation(let detail):
      return "analysis.json violates the schemaVersion 2 contract: \(detail)"
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
  if inp.trackSamples > 0 {
    notes.append(String(
      format: "%d pose samples (COCO-17 keypoints, ~%.0f Hz) written for the skeleton overlay",
      inp.trackSamples, ShotClass.trackHz
    ))
  }
  if inp.appearanceAttempted > 0 {
    let pct = 100.0 * Double(inp.appearanceDescribed) / Double(inp.appearanceAttempted)
    notes.append(String(
      format: "player identity from torso appearance (rg-chromaticity + exposure-relative luma) fused with court position; %.0f%% of detections described",
      pct
    ))
    if inp.appearanceUnsupportedFrames > 0 {
      notes.append(
        "\(inp.appearanceUnsupportedFrames) frames could not be read for appearance; "
          + "identity fell back to court position alone on those"
      )
    }
  }
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
  if inp.nRallyGated > 0 {
    notes.append(
      "\(inp.nRallyGated) further onsets rejected as between-point noise "
        + "(no rally in progress on this court)"
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
      let shotType = classifyShot(
        isFirstOfRally: k == 0,
        highContact: shot.highContact,
        striker: shot.court,
        land: next.court,
        lowConfidencePose: shot.lowConfidence || next.lowConfidence
      )
      shotsOut.append([
        "tSec": round2(shot.t),
        "player": shot.pid,
        "cell": cell,
        "type": shotType.type,
        "typeConfidence": round3(shotType.confidence),
      ])
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
    "schemaVersion": 2,
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
  guard var json = String(data: data, encoding: .utf8) else {
    throw AnalysisBuildError.serializationFailed
  }
  try validateAnalysisShape(data)

  // `tracks` is spliced into the finished document instead of being round-tripped
  // through JSONSerialization: it is by far the largest part of the file, and it
  // arrives already serialized (TrackWriter) precisely so the keypoints never
  // exist as Foundation objects. Object key order carries no meaning in JSON, so
  // going in right after the opening brace is safe.
  if let tracks = inp.tracksJSON, !tracks.isEmpty {
    guard json.hasPrefix("{"), json.dropFirst().first != "}" else {
      throw AnalysisBuildError.serializationFailed
    }
    json.insert(contentsOf: "\"tracks\":\(tracks),", at: json.index(after: json.startIndex))
  }
  return json
}

/// Mirror of the load-bearing checks in src/features/analysis/types.ts
/// parseAnalysis — a shape this fails would parse to null in the app. Runs on
/// the document before `tracks` is spliced in; those samples are correct by
/// construction (TrackWriter is the only writer) and re-parsing megabytes of
/// keypoints just to check them would undo the point of streaming them.
func validateAnalysisShape(_ data: Data) throws {
  func fail(_ detail: String) throws -> Never {
    throw AnalysisBuildError.contractViolation(detail)
  }
  guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    try fail("root is not an object")
  }
  guard root["schemaVersion"] as? Int == 2 else { try fail("schemaVersion != 2") }
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
  let shotTypes = ["serve", "drive", "crossCourt", "drop", "boast", "volley", "unknown"]
  for shot in shots {
    guard (shot["tSec"] as? NSNumber)?.doubleValue ?? -1 >= 0,
          let pid = shot["player"] as? String, pid == "A" || pid == "B",
          let cell = shot["cell"] as? String,
          ["frontLeft", "frontRight", "backLeft", "backRight"].contains(cell) else {
      try fail("shot event")
    }
    if let type = shot["type"] {
      guard let type = type as? String, shotTypes.contains(type) else { try fail("shot type") }
      guard let conf = (shot["typeConfidence"] as? NSNumber)?.doubleValue,
            conf >= 0, conf <= 1 else { try fail("shot typeConfidence") }
    }
  }
  guard let quality = root["quality"] as? [String: Any],
        (quality["framesAnalyzed"] as? NSNumber)?.doubleValue ?? -1 >= 0,
        let both = (quality["bothPlayersDetectedPct"] as? NSNumber)?.doubleValue,
        both >= 0, both <= 100,
        quality["audioAvailable"] is Bool || quality["audioAvailable"] as? NSNumber != nil,
        quality["notes"] is [String] else { try fail("quality") }
}
