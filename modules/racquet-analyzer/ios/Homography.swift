// Homography.swift — 4-point planar homography via DLT, solved as an 8x8
// linear system with Gaussian elimination (partial pivoting). Pure Foundation
// so it compiles standalone for off-device unit checks.
//
// Mirrors analyze.py's cv2.getPerspectiveTransform(src, dst): src is the four
// tapped court corners (normalized reference-frame coords — values may fall
// outside 0..1 when a corner sits outside the camera frame), dst is court
// meters (x in [0, 6.4], y in [0, 9.75], front wall y = 0).

import Foundation

struct Homography {
  /// Row-major 3x3 matrix, m[8] normalized to 1.
  let m: [Double]

  /// Solve H such that H * [src_i, 1] ~ [dst_i, 1] for the 4 correspondences.
  /// Returns nil for degenerate configurations (collinear corners).
  static func solve4Point(src: [(x: Double, y: Double)], dst: [(x: Double, y: Double)]) -> Homography? {
    guard src.count == 4, dst.count == 4 else { return nil }
    // Rows of the 8x9 augmented system A|b with h9 = 1:
    //   [x y 1 0 0 0 -X*x -X*y | X]
    //   [0 0 0 x y 1 -Y*x -Y*y | Y]
    var a = [[Double]](repeating: [Double](repeating: 0, count: 9), count: 8)
    for i in 0..<4 {
      let (x, y) = (src[i].x, src[i].y)
      let (bigX, bigY) = (dst[i].x, dst[i].y)
      a[2 * i] = [x, y, 1, 0, 0, 0, -bigX * x, -bigX * y, bigX]
      a[2 * i + 1] = [0, 0, 0, x, y, 1, -bigY * x, -bigY * y, bigY]
    }
    // Gaussian elimination with partial pivoting.
    for col in 0..<8 {
      var pivot = col
      for row in (col + 1)..<8 where abs(a[row][col]) > abs(a[pivot][col]) {
        pivot = row
      }
      guard abs(a[pivot][col]) > 1e-12 else { return nil }
      a.swapAt(col, pivot)
      for row in (col + 1)..<8 {
        let factor = a[row][col] / a[col][col]
        guard factor != 0 else { continue }
        for c in col..<9 {
          a[row][c] -= factor * a[col][c]
        }
      }
    }
    // Back substitution.
    var h = [Double](repeating: 0, count: 8)
    for row in stride(from: 7, through: 0, by: -1) {
      var acc = a[row][8]
      for c in (row + 1)..<8 {
        acc -= a[row][c] * h[c]
      }
      h[row] = acc / a[row][row]
    }
    return Homography(m: [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0])
  }

  /// Project a point through the homography.
  func project(_ x: Double, _ y: Double) -> (x: Double, y: Double) {
    let w = m[6] * x + m[7] * y + m[8]
    // Guard the divide; a point on the horizon line has w ~ 0.
    let safeW = abs(w) > 1e-12 ? w : (w < 0 ? -1e-12 : 1e-12)
    return (
      (m[0] * x + m[1] * y + m[2]) / safeW,
      (m[3] * x + m[4] * y + m[5]) / safeW
    )
  }
}
