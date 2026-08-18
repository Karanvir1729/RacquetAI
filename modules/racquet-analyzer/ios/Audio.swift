// Audio.swift — audio track decode (AVAssetReader, mono float 22.05 kHz),
// short-time RMS energy envelope (~10 ms hop) and adaptive onset picking
// (sliding median + k*MAD, plus a global height floor mirroring analyze.py's
// `height=med + 1.0*(p95-med)`), merged at ONSET_MERGE_S keeping the
// stronger peak.

import AVFoundation
import Foundation

struct AudioEnvelope {
  var times: [Double]
  var values: [Double]
}

enum AudioError: LocalizedError {
  case readerFailed(String)

  var errorDescription: String? {
    switch self {
    case .readerFailed(let detail): return "audio decode failed: \(detail)"
    }
  }
}

/// Decode the first audio track to mono float samples at 22.05 kHz.
/// Returns nil when the asset has no audio track.
func readMonoAudio(asset: AVAsset, sampleRate: Double = AnalyzerParams.audioSampleRate) throws -> [Float]? {
  guard let track = asset.tracks(withMediaType: .audio).first else { return nil }
  let reader = try AVAssetReader(asset: asset)
  let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatLinearPCM,
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 32,
    AVLinearPCMIsFloatKey: true,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleaved: false,
  ]
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
  output.alwaysCopiesSampleData = false
  guard reader.canAdd(output) else {
    throw AudioError.readerFailed("cannot add audio output")
  }
  reader.add(output)
  guard reader.startReading() else {
    throw AudioError.readerFailed(reader.error?.localizedDescription ?? "startReading failed")
  }
  var samples: [Float] = []
  while let sampleBuffer = output.copyNextSampleBuffer() {
    autoreleasepool {
      guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
      let byteLength = CMBlockBufferGetDataLength(blockBuffer)
      let count = byteLength / MemoryLayout<Float>.size
      guard count > 0 else { return }
      var chunk = [Float](repeating: 0, count: count)
      let status = chunk.withUnsafeMutableBytes { raw -> OSStatus in
        guard let base = raw.baseAddress else { return kCMBlockBufferBadPointerParameterErr }
        return CMBlockBufferCopyDataBytes(
          blockBuffer,
          atOffset: 0,
          dataLength: count * MemoryLayout<Float>.size,
          destination: base
        )
      }
      if status == kCMBlockBufferNoErr {
        samples.append(contentsOf: chunk)
      }
    }
  }
  if reader.status == .failed {
    throw AudioError.readerFailed(reader.error?.localizedDescription ?? "reader failed")
  }
  return samples
}

/// Short-time RMS energy envelope: ~20 ms window, ~10 ms hop.
func rmsEnvelope(
  _ samples: [Float],
  sampleRate: Double = AnalyzerParams.audioSampleRate,
  hopS: Double = AnalyzerParams.audioHopS,
  winS: Double = AnalyzerParams.audioWinS
) -> AudioEnvelope {
  let hop = max(1, Int(hopS * sampleRate))
  let win = max(hop, Int(winS * sampleRate))
  var times: [Double] = []
  var values: [Double] = []
  var start = 0
  while start + win <= samples.count {
    var acc = 0.0
    for i in start..<(start + win) {
      let v = Double(samples[i])
      acc += v * v
    }
    values.append((acc / Double(win)).squareRoot())
    times.append((Double(start) + Double(win) / 2.0) / sampleRate)
    start += hop
  }
  return AudioEnvelope(times: times, values: values)
}

/// Onset times: local envelope maxima above BOTH
///  - a sliding adaptive threshold, median + k*MAD over a +/-1 s window, and
///  - a global height floor, med + 1.0*(p95 - med) (analyze.py's `height=thr`),
/// then merged so onsets are >= ONSET_MERGE_S apart (stronger peak wins).
func audioOnsets(_ envelope: AudioEnvelope) -> [Double] {
  let v = envelope.values
  guard v.count >= 3 else { return [] }
  let globalMed = median(v)
  let p95 = percentile(v, 95)
  let heightFloor = globalMed + 1.0 * (p95 - globalMed)
  let halfWin = max(1, Int(AnalyzerParams.onsetMedianHalfWinS / AnalyzerParams.audioHopS))
  var candidates: [(t: Double, val: Double)] = []
  for i in 1..<(v.count - 1) {
    guard v[i] >= v[i - 1] && v[i] >= v[i + 1] else { continue } // local max
    guard v[i] > heightFloor else { continue }
    let lo = max(0, i - halfWin)
    let hi = min(v.count - 1, i + halfWin)
    let window = Array(v[lo...hi])
    let med = median(window)
    let mad = median(window.map { abs($0 - med) })
    let threshold = med + AnalyzerParams.onsetMadK * max(mad, 1e-9)
    if v[i] > threshold {
      candidates.append((envelope.times[i], v[i]))
    }
  }
  var merged: [(t: Double, val: Double)] = []
  for c in candidates {
    if let last = merged.last, c.t - last.t < AnalyzerParams.onsetMergeS {
      if c.val > last.val { merged[merged.count - 1] = c }
    } else {
      merged.append(c)
    }
  }
  return merged.map { $0.t }
}
