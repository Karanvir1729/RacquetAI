// Pose.swift — multi-person 2D body pose via VNDetectHumanBodyPoseRequest.
//
// Vision returns joints normalized with origin at the BOTTOM-left of the
// oriented image; we flip y and scale into upright pixel coords so downstream
// math (bbox sizes, wrist speeds) matches analyze.py's pixel-space logic, and
// normalized coords passed to the homography match the reference frame the
// corners were tapped in.

import CoreVideo
import Foundation
import Vision

final class PoseDetector {
  private let request = VNDetectHumanBodyPoseRequest()

  private static let jointNames: [(VNHumanBodyPoseObservation.JointName, String)] = [
    (.nose, "nose"),
    (.neck, "neck"),
    (.leftEye, "leftEye"),
    (.rightEye, "rightEye"),
    (.leftEar, "leftEar"),
    (.rightEar, "rightEar"),
    (.leftShoulder, "leftShoulder"),
    (.rightShoulder, "rightShoulder"),
    (.leftElbow, "leftElbow"),
    (.rightElbow, "rightElbow"),
    (.leftWrist, "leftWrist"),
    (.rightWrist, "rightWrist"),
    (.root, "root"),
    (.leftHip, "leftHip"),
    (.rightHip, "rightHip"),
    (.leftKnee, "leftKnee"),
    (.rightKnee, "rightKnee"),
    (.leftAnkle, "leftAnkle"),
    (.rightAnkle, "rightAnkle"),
  ]

  /// All detected people in a frame as joint dictionaries in upright pixel
  /// coords (y down).
  func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    uprightWidth: Double,
    uprightHeight: Double
  ) throws -> [[String: JointPoint]] {
    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: orientation,
      options: [:]
    )
    try handler.perform([request])
    var people: [[String: JointPoint]] = []
    for observation in request.results ?? [] {
      guard let points = try? observation.recognizedPoints(.all) else { continue }
      var joints: [String: JointPoint] = [:]
      for (name, key) in Self.jointNames {
        guard let p = points[name], p.confidence > 0 else { continue }
        joints[key] = JointPoint(
          x: Double(p.location.x) * uprightWidth,
          y: (1.0 - Double(p.location.y)) * uprightHeight, // flip: Vision origin is bottom-left
          conf: Double(p.confidence)
        )
      }
      if !joints.isEmpty {
        people.append(joints)
      }
    }
    return people
  }
}
