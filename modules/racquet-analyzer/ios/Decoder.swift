// Decoder.swift — video probing, sampled BGRA frame decode (AVAssetReader),
// and mid-video reference-frame JPEG extraction.
//
// Vision requests receive the encoded pixel buffer plus a
// CGImagePropertyOrientation derived from the track's preferredTransform, so
// pose landmarks come back normalized in the UPRIGHT frame — the same space
// the user tapped court corners in (the reference JPEG applies the transform).

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct VideoInfo {
  let uprightWidth: Int
  let uprightHeight: Int
  let fps: Double
  let durationSec: Double
  let orientation: CGImagePropertyOrientation
  let hasAudio: Bool
}

enum DecoderError: LocalizedError {
  case noVideoTrack
  case readerFailed(String)
  case referenceFrameFailed(String)

  var errorDescription: String? {
    switch self {
    case .noVideoTrack: return "the file has no video track"
    case .readerFailed(let detail): return "video decode failed: \(detail)"
    case .referenceFrameFailed(let detail): return "reference frame extraction failed: \(detail)"
    }
  }
}

/// Map a video track's preferredTransform to the EXIF orientation Vision needs.
func orientationFromTransform(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
  if t.a == 0 && t.b == 1 && t.c == -1 && t.d == 0 { return .right } // 90° CW (portrait)
  if t.a == 0 && t.b == -1 && t.c == 1 && t.d == 0 { return .left } // 90° CCW
  if t.a == -1 && t.b == 0 && t.c == 0 && t.d == -1 { return .down } // 180°
  return .up
}

func probeVideo(asset: AVAsset) throws -> VideoInfo {
  guard let track = asset.tracks(withMediaType: .video).first else {
    throw DecoderError.noVideoTrack
  }
  let orientation = orientationFromTransform(track.preferredTransform)
  let size = track.naturalSize
  let swapped = orientation == .right || orientation == .left
  let width = Int((swapped ? size.height : size.width).rounded())
  let height = Int((swapped ? size.width : size.height).rounded())
  let fps = Double(track.nominalFrameRate)
  return VideoInfo(
    uprightWidth: width,
    uprightHeight: height,
    fps: fps > 0 ? fps : 30.0,
    durationSec: CMTimeGetSeconds(asset.duration),
    orientation: orientation,
    hasAudio: !asset.tracks(withMediaType: .audio).isEmpty
  )
}

/// Decode the video track as 32BGRA and invoke `onFrame` for ~sampleFps frames
/// per second (frame-index skipping, stride = round(fps / sampleFps)).
/// `onFrame` receives the pixel buffer and the presentation time in seconds.
func decodeSampledFrames(
  asset: AVAsset,
  info: VideoInfo,
  sampleFps: Double,
  onFrame: (CVPixelBuffer, Double) throws -> Void
) throws {
  guard let track = asset.tracks(withMediaType: .video).first else {
    throw DecoderError.noVideoTrack
  }
  let reader = try AVAssetReader(asset: asset)
  let settings: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  ]
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
  output.alwaysCopiesSampleData = false
  guard reader.canAdd(output) else {
    throw DecoderError.readerFailed("cannot add video output")
  }
  reader.add(output)
  guard reader.startReading() else {
    throw DecoderError.readerFailed(reader.error?.localizedDescription ?? "startReading failed")
  }
  let stride = max(1, Int((info.fps / max(sampleFps, 0.1)).rounded()))
  var index = 0
  while true {
    guard let sampleBuffer = output.copyNextSampleBuffer() else { break }
    try autoreleasepool {
      defer { index += 1 }
      guard index % stride == 0 else { return }
      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
      let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      try onFrame(pixelBuffer, t)
    }
  }
  if reader.status == .failed {
    throw DecoderError.readerFailed(reader.error?.localizedDescription ?? "reader failed")
  }
}

struct ReferenceFrame {
  let uri: String
  let width: Int
  let height: Int
}

enum ReferenceFrameExtractor {
  /// Mid-video frame, orientation-corrected, saved as JPEG in the cache dir.
  static func extract(from url: URL) throws -> ReferenceFrame {
    let asset = AVURLAsset(url: url)
    let duration = CMTimeGetSeconds(asset.duration)
    guard duration.isFinite, duration > 0 else {
      throw DecoderError.referenceFrameFailed("could not read video duration")
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    let tolerance = CMTime(seconds: 0.5, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    let mid = CMTime(seconds: duration / 2.0, preferredTimescale: 600)
    var actualTime = CMTime.zero
    let cgImage: CGImage
    do {
      cgImage = try generator.copyCGImage(at: mid, actualTime: &actualTime)
    } catch {
      throw DecoderError.referenceFrameFailed(error.localizedDescription)
    }
    let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let outURL = cacheDir.appendingPathComponent("racquet-ref-\(UUID().uuidString).jpg")
    guard let destination = CGImageDestinationCreateWithURL(
      outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil
    ) else {
      throw DecoderError.referenceFrameFailed("cannot create JPEG destination")
    }
    let options = [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary
    CGImageDestinationAddImage(destination, cgImage, options)
    guard CGImageDestinationFinalize(destination) else {
      throw DecoderError.referenceFrameFailed("JPEG write failed")
    }
    return ReferenceFrame(uri: outURL.absoluteString, width: cgImage.width, height: cgImage.height)
  }
}
