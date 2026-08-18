// Appearance.swift — reads each detection's shirt out of the decoded frame.
//
// This is the only part of the identity fix that needs real pixels; the
// geometry, the descriptor algebra and the tracker itself live in Stats.swift
// and stay Foundation-only. Port of analyze.py's frame_exposure_ref /
// torso_appearance, with the one thing OpenCV gets for free and Vision does
// not: the pixel buffer arrives in the CAMERA's orientation, while the joints
// have already been mapped into the upright frame, so the patch rect has to be
// rotated back before it can be read.
//
// Nothing here retains a frame. `describe` is called inside the decode
// callback, reads what it needs while the buffer is still locked, and returns
// three Doubles per player — a 6-minute match at 8 Hz is ~2900 frames and not
// one of them outlives its callback.

import CoreVideo
import Foundation
import ImageIO

/// Samples torso patches out of decoded frames. Stateful only in that it reuses
/// its histogram scratch buffers across frames; call it from one thread.
final class TorsoAppearanceSampler {
  /// Detections offered a descriptor (i.e. every detection seen).
  private(set) var attempted = 0
  /// Detections that actually got one.
  private(set) var described = 0
  /// Set when the frame format or orientation is one this sampler cannot read,
  /// so the caller can say so out loud instead of silently reverting to
  /// position-only tracking — which is the bug this whole change removes.
  private(set) var unsupportedFrames = 0

  private var grayHistogram = [Int](repeating: 0, count: 256)
  private var blueHistogram = [Int](repeating: 0, count: 256)
  private var greenHistogram = [Int](repeating: 0, count: 256)
  private var redHistogram = [Int](repeating: 0, count: 256)

  /// Fill `app` on every detection that has a readable torso patch.
  ///
  /// `uprightWidth`/`uprightHeight` are the coordinate space the joints are in
  /// (Pose.swift's upright pixels). They normally equal the pixel buffer's own
  /// upright size; when they do not, the patch is scaled rather than abandoned.
  func describe(
    _ dets: inout [PlayerDetection],
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    uprightWidth: Double,
    uprightHeight: Double
  ) {
    attempted += dets.count
    guard !dets.isEmpty else { return }
    guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
          uprightWidth > 0, uprightHeight > 0 else {
      unsupportedFrames += 1
      return
    }

    let bufferW = CVPixelBufferGetWidth(pixelBuffer)
    let bufferH = CVPixelBufferGetHeight(pixelBuffer)
    guard bufferW > 0, bufferH > 0 else {
      unsupportedFrames += 1
      return
    }
    // The buffer's own upright dimensions: a 90-degree rotation swaps them.
    let swapped = (orientation == .right || orientation == .left)
    let uprightBufferW = swapped ? bufferH : bufferW
    let uprightBufferH = swapped ? bufferW : bufferH
    // Probe the orientation before touching pixels: an orientation this cannot
    // undo means no descriptors this frame, not descriptors of the wrong pixels.
    guard Self.bufferRect(
      PixelRect(x0: 0, y0: 0, x1: 1, y1: 1),
      orientation: orientation, bufferWidth: bufferW, bufferHeight: bufferH
    ) != nil else {
      unsupportedFrames += 1
      return
    }
    let scaleX = Double(uprightBufferW) / uprightWidth
    let scaleY = Double(uprightBufferH) / uprightHeight

    // Work out the patches first: if no detection has one, the frame's pixels
    // are never touched at all.
    let rects: [PixelRect?] = dets.map {
      torsoPatchBox(
        joints: $0.joints,
        width: uprightBufferW,
        height: uprightBufferH,
        scaleX: scaleX,
        scaleY: scaleY
      )
    }
    guard rects.contains(where: { $0 != nil }) else { return }

    guard CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly) == kCVReturnSuccess else {
      unsupportedFrames += 1
      return
    }
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else {
      unsupportedFrames += 1
      return
    }
    let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard rowBytes >= bufferW * 4 else {
      unsupportedFrames += 1
      return
    }
    let pixels = base.assumingMemoryBound(to: UInt8.self)

    // One exposure reference per frame, shared by both players — that sharing
    // is the whole point: it is what makes an auto-exposure step cancel.
    let exposureRef = exposureReference(
      pixels: pixels, rowBytes: rowBytes, width: bufferW, height: bufferH
    )

    for i in dets.indices {
      guard let uprightRect = rects[i],
            let rect = Self.bufferRect(
              uprightRect,
              orientation: orientation,
              bufferWidth: bufferW,
              bufferHeight: bufferH
            ),
            rect.width > 0, rect.height > 0 else { continue }
      let med = patchMedians(pixels: pixels, rowBytes: rowBytes, rect: rect)
      guard let app = appearanceFromMedians(
        b: med.b, g: med.g, r: med.r, exposureRef: exposureRef
      ) else { continue }
      dets[i].app = app
      described += 1
    }
  }

  // MARK: - Orientation

  /// Map a rect in the buffer's UPRIGHT frame back to the buffer's own pixel
  /// grid, or nil for an orientation this cannot undo.
  ///
  /// `orientationFromTransform` only ever yields the four pure rotations, so
  /// there is no mirroring to handle — and anything else returns nil rather
  /// than a plausible-looking rect over the wrong pixels, which would poison
  /// every descriptor while the pipeline looked perfectly healthy.
  ///
  /// `.right` (EXIF 6) means the stored image must be rotated 90 degrees
  /// clockwise to display: upright x = bufferHeight - 1 - buffer y, upright
  /// y = buffer x. `.left` (EXIF 8) is the same the other way round.
  static func bufferRect(
    _ r: PixelRect,
    orientation: CGImagePropertyOrientation,
    bufferWidth bw: Int,
    bufferHeight bh: Int
  ) -> PixelRect? {
    let mapped: PixelRect
    switch orientation {
    case .up:
      mapped = r
    case .down:
      mapped = PixelRect(x0: bw - r.x1, y0: bh - r.y1, x1: bw - r.x0, y1: bh - r.y0)
    case .right:
      mapped = PixelRect(x0: r.y0, y0: bh - r.x1, x1: r.y1, y1: bh - r.x0)
    case .left:
      mapped = PixelRect(x0: bw - r.y1, y0: r.x0, x1: bw - r.y0, y1: r.x1)
    default:
      return nil
    }
    return PixelRect(
      x0: min(max(mapped.x0, 0), bw),
      y0: min(max(mapped.y0, 0), bh),
      x1: min(max(mapped.x1, 0), bw),
      y1: min(max(mapped.y1, 0), bh)
    )
  }

  // MARK: - Pixel reductions

  /// Port of frame_exposure_ref: median grey of the frame downsampled 8x.
  ///
  /// The 8x downsample is not cosmetic — averaging first is what makes this the
  /// median of the scene's *regions* rather than of its pixels, and analyze.py
  /// computes exactly that. Destination cells cover whole source spans, which
  /// is what INTER_AREA reduces to at an integer scale.
  private func exposureReference(
    pixels: UnsafePointer<UInt8>, rowBytes: Int, width: Int, height: Int
  ) -> Double {
    let dw = max(1, Int((Double(width) / 8.0).rounded()))
    let dh = max(1, Int((Double(height) / 8.0).rounded()))
    for i in 0..<256 { grayHistogram[i] = 0 }
    for j in 0..<dh {
      let sy0 = height * j / dh
      let sy1 = max(height * (j + 1) / dh, sy0 + 1)
      for i in 0..<dw {
        let sx0 = width * i / dw
        let sx1 = max(width * (i + 1) / dw, sx0 + 1)
        // Integer accumulation of 1000x luma: 0.299 R + 0.587 G + 0.114 B.
        var sum = 0
        var n = 0
        for y in sy0..<sy1 {
          let row = pixels + y * rowBytes
          for x in sx0..<sx1 {
            let p = row + x * 4
            sum += 299 * Int(p[2]) + 587 * Int(p[1]) + 114 * Int(p[0])
            n += 1
          }
        }
        let avg = Double(sum) / (1000.0 * Double(max(n, 1)))
        grayHistogram[min(max(Int(avg.rounded()), 0), 255)] += 1
      }
    }
    return Self.median(of: grayHistogram, count: dw * dh)
  }

  /// Per-channel MEDIAN over the patch. A racquet, an arm or a line of
  /// background crossing the patch moves a mean but not a median — which is why
  /// this replaced the single-pixel sample the old pipeline took.
  private func patchMedians(
    pixels: UnsafePointer<UInt8>, rowBytes: Int, rect: PixelRect
  ) -> (b: Double, g: Double, r: Double) {
    for i in 0..<256 {
      blueHistogram[i] = 0
      greenHistogram[i] = 0
      redHistogram[i] = 0
    }
    var n = 0
    for y in rect.y0..<rect.y1 {
      let row = pixels + y * rowBytes
      for x in rect.x0..<rect.x1 {
        let p = row + x * 4
        blueHistogram[Int(p[0])] += 1
        greenHistogram[Int(p[1])] += 1
        redHistogram[Int(p[2])] += 1
        n += 1
      }
    }
    return (
      Self.median(of: blueHistogram, count: n),
      Self.median(of: greenHistogram, count: n),
      Self.median(of: redHistogram, count: n)
    )
  }

  /// numpy's median over a 256-bin histogram: the middle value, or the mean of
  /// the two middle values when the count is even.
  static func median(of histogram: [Int], count n: Int) -> Double {
    guard n > 0 else { return 0 }
    if n % 2 == 1 {
      return Double(orderStatistic(histogram, rank: (n - 1) / 2))
    }
    let lo = orderStatistic(histogram, rank: n / 2 - 1)
    let hi = orderStatistic(histogram, rank: n / 2)
    return 0.5 * (Double(lo) + Double(hi))
  }

  /// Smallest bin whose cumulative count exceeds `rank` (0-indexed).
  private static func orderStatistic(_ histogram: [Int], rank: Int) -> Int {
    var seen = 0
    for value in 0..<histogram.count {
      seen += histogram[value]
      if seen > rank { return value }
    }
    return histogram.count - 1
  }
}
