// RacquetAnalyzerModule.swift — Expo Modules entry point plus the pipeline
// orchestrator (MatchAnalyzer). Faithful port of analysis/analyze.py minus the
// ORB drift alignment (the on-device flow assumes a stationary phone; the
// 4-corner homography maps the reference frame directly).

import AVFoundation
import ExpoModulesCore
import Foundation

public class RacquetAnalyzerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RacquetAnalyzer")

    Events("analysisProgress")

    AsyncFunction("extractReferenceFrame") { (videoUri: String) -> [String: Any] in
      let url = Self.parseUri(videoUri)
      let frame = try ReferenceFrameExtractor.extract(from: url)
      return ["uri": frame.uri, "width": frame.width, "height": frame.height]
    }

    // Hardware-encoded 960x540 H.264 export for the server upload path. The
    // server downscales to 854px before analyzing, so 960-wide loses nothing —
    // it just makes the upload ~10x smaller than a camera original.
    AsyncFunction("compressVideo") { (videoUri: String, promise: Promise) in
      let url = Self.parseUri(videoUri)
      let asset = AVURLAsset(url: url)
      guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset960x540) else {
        promise.reject("ERR_COMPRESS", "This video cannot be exported at 960x540.")
        return
      }
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("racquet-upload-\(UUID().uuidString).mp4")
      session.outputURL = out
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true
      session.exportAsynchronously {
        if session.status == .completed {
          let size = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? Int) ?? 0
          promise.resolve(["uri": out.absoluteString, "bytes": size ?? 0])
        } else {
          promise.reject("ERR_COMPRESS", session.error?.localizedDescription ?? "Video export failed.")
        }
      }
    }

    AsyncFunction("analyzeMatch") { (videoUri: String, cornersJson: String, optionsJson: String) -> String in
      let url = Self.parseUri(videoUri)
      let analyzer = try MatchAnalyzer(
        url: url,
        cornersJson: cornersJson,
        optionsJson: optionsJson
      ) { [weak self] stage, pct in
        self?.sendEvent("analysisProgress", ["stage": stage, "pct": pct])
      }
      return try analyzer.run()
    }
  }

  static func parseUri(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uri)
  }
}

enum AnalyzerInputError: LocalizedError {
  case badCorners(String)
  case badOptions(String)
  case degenerateCorners

  var errorDescription: String? {
    switch self {
    case .badCorners(let detail): return "cornersJson invalid: \(detail)"
    case .badOptions(let detail): return "optionsJson invalid: \(detail)"
    case .degenerateCorners: return "the four corners are degenerate (collinear); re-tap them"
    }
  }
}

/// One full pipeline run: decode + pose + track, onsets, attribution,
/// rallies, analytics, analysis.json string.
final class MatchAnalyzer {
  private let url: URL
  private let corners: [String: (Double, Double)]
  private let sampleFps: Double
  private let progress: (String, Double) -> Void
  private var lastPct = -10.0

  init(
    url: URL,
    cornersJson: String,
    optionsJson: String,
    progress: @escaping (String, Double) -> Void
  ) throws {
    self.url = url
    self.progress = progress

    guard let cornersData = cornersJson.data(using: .utf8),
          let rawCorners = try? JSONSerialization.jsonObject(with: cornersData) as? [String: Any]
    else {
      throw AnalyzerInputError.badCorners("not a JSON object")
    }
    var parsed: [String: (Double, Double)] = [:]
    for key in ["frontLeft", "frontRight", "backLeft", "backRight"] {
      guard let pair = rawCorners[key] as? [NSNumber], pair.count == 2 else {
        throw AnalyzerInputError.badCorners("missing or malformed \"\(key)\" (want [nx, ny])")
      }
      parsed[key] = (pair[0].doubleValue, pair[1].doubleValue)
    }
    self.corners = parsed

    var fps = AnalyzerParams.defaultSampleFps
    if let optionsData = optionsJson.data(using: .utf8),
       let rawOptions = try? JSONSerialization.jsonObject(with: optionsData) as? [String: Any] {
      if let v = rawOptions["sampleFps"] as? NSNumber {
        fps = v.doubleValue
        guard fps > 0, fps <= 120 else {
          throw AnalyzerInputError.badOptions("sampleFps out of range")
        }
      }
    } else if !optionsJson.isEmpty {
      throw AnalyzerInputError.badOptions("not a JSON object")
    }
    self.sampleFps = fps
  }

  private func emit(_ stage: String, _ pct: Double) {
    // Throttle to >= 1% steps so the bridge is not flooded at 8 fps.
    if pct - lastPct >= 1.0 || pct >= 100.0 {
      lastPct = pct
      progress(stage, min(pct, 100.0))
    }
  }

  func run() throws -> String {
    emit("decoding", 0)
    let asset = AVURLAsset(url: url)
    let info = try probeVideo(asset: asset)
    let width = Double(info.uprightWidth)
    let height = Double(info.uprightHeight)

    // Corners are normalized in the (upright) reference frame; the DLT maps
    // them straight onto court meters (front wall y = 0).
    let src = [
      corners["frontLeft"]!, corners["frontRight"]!,
      corners["backLeft"]!, corners["backRight"]!,
    ].map { (x: $0.0, y: $0.1) }
    let dst: [(x: Double, y: Double)] = [
      (0, 0), (Court.width, 0), (0, Court.length), (Court.width, Court.length),
    ]
    guard let homography = Homography.solve4Point(src: src, dst: dst) else {
      throw AnalyzerInputError.degenerateCorners
    }
    emit("decoding", 5)

    // Pass 1: sampled decode + pose + court filter + 2-ID tracking. The
    // skeleton overlay's keypoints are serialized here, one sample at a time,
    // rather than reconstructed from trackFrames at the end.
    let poseDetector = PoseDetector()
    let tracker = TwoTracker()
    let trackWriter = TrackWriter()
    var times: [Double] = []
    var trackFrames: [[String: PlayerDetection]] = []
    let duration = max(info.durationSec, 0.001)
    try decodeSampledFrames(asset: asset, info: info, sampleFps: sampleFps) { pixelBuffer, t in
      let rawPoses = try self.poseSafely(poseDetector, pixelBuffer, info, width, height)
      let dets = detectPlayers(
        rawPoses: rawPoses, homography: homography, width: width, height: height
      )
      let tracked = tracker.update(dets)
      times.append(t)
      trackFrames.append(tracked)
      trackWriter.append(t: t, players: tracked, width: width, height: height)
      self.emit("pose", 5 + 65 * min(t / duration, 1.0))
    }
    emit("pose", 70)

    // Shot moments: audio onsets, or wrist-speed peaks without an audio track.
    var audioAvailable = false
    var onsets: [Double] = []
    if info.hasAudio, let samples = try? readMonoAudio(asset: asset), !samples.isEmpty {
      audioAvailable = true
      let envelope = rmsEnvelope(samples)
      emit("audio", 85)
      onsets = audioOnsets(envelope).filter { $0 <= info.durationSec }
    } else {
      onsets = wristSpeedOnsets(trackFrames: trackFrames, times: times)
    }
    emit("audio", 90)

    // Striker attribution with the player-activity gate (swing discriminator).
    var shotsRaw: [RawShot] = []
    var nGated = 0
    for t in onsets {
      let lo = max(0, lowerBound(times, t - AnalyzerParams.wristWinS))
      let hi = min(times.count - 1, lowerBound(times, t + AnalyzerParams.wristWinS))
      guard hi >= lo else { continue }
      var trav: [String: Double] = [:]
      var obs: [String: Int] = [:]
      for pid in ["A", "B"] {
        let r = peakWristSpeed(trackFrames: trackFrames, times: times, lo: lo, hi: hi, pid: pid)
        trav[pid] = r.peak
        obs[pid] = r.obs
      }
      if (obs["A"] ?? 0) >= 2 || (obs["B"] ?? 0) >= 2 {
        if audioAvailable, max(trav["A"] ?? 0, trav["B"] ?? 0) < AnalyzerParams.wristPeakGate {
          nGated += 1
          continue
        }
      } else {
        // Wrists never seen in the window: ankle-travel fallback.
        for pid in ["A", "B"] {
          trav[pid] = anklePathLength(trackFrames: trackFrames, times: times, lo: lo, hi: hi, pid: pid)
        }
        let gate = audioAvailable ? AnalyzerParams.ankleGateMeters : 1e-9
        if max(trav["A"] ?? 0, trav["B"] ?? 0) < gate {
          nGated += 1
          continue
        }
      }
      let pid = (trav["A"] ?? 0) >= (trav["B"] ?? 0) ? "A" : "B"
      guard let i = nearestTracked(trackFrames: trackFrames, times: times, t: t, pid: pid),
            let det = trackFrames[i][pid] else { continue }
      shotsRaw.append(RawShot(
        t: t,
        pid: pid,
        court: det.court,
        highContact: isHighContact(det.joints),
        lowConfidence: det.posConf < ShotClass.poseConfLow
      ))
    }

    emit("stats", 95)
    let trackSamples = trackWriter.sampleCount
    let json = try buildAnalysisJSON(AnalysisInputs(
      sourceName: url.lastPathComponent,
      durationSec: info.durationSec,
      fps: info.fps,
      width: info.uprightWidth,
      height: info.uprightHeight,
      sampleFps: sampleFps,
      times: times,
      trackFrames: trackFrames,
      onsets: onsets,
      shotsRaw: shotsRaw,
      nGated: nGated,
      audioAvailable: audioAvailable,
      tracksJSON: trackWriter.takeJSON(),
      trackSamples: trackSamples
    ))
    emit("stats", 100)
    return json
  }

  /// A single frame Vision failure should not sink a whole match — treat it
  /// as "no people seen this frame".
  private func poseSafely(
    _ detector: PoseDetector,
    _ pixelBuffer: CVPixelBuffer,
    _ info: VideoInfo,
    _ width: Double,
    _ height: Double
  ) throws -> [[String: JointPoint]] {
    (try? detector.detect(
      pixelBuffer: pixelBuffer,
      orientation: info.orientation,
      uprightWidth: width,
      uprightHeight: height
    )) ?? []
  }
}
