// LiveSession.swift — the live capture pipeline: camera + microphone in,
// LiveRallyEngine events out.
//
// The offline analyser reads a file with AVAssetReader. This is the same
// processing chain fed by an AVCaptureSession instead: Vision body pose on the
// video buffers, the streaming onset detector on the audio buffers, both
// stamped with the capture session's own clock so they line up.
//
// THREE RULES THIS FILE EXISTS TO KEEP
//
// 1. Frames are never retained. Every CMSampleBuffer is processed inside its
//    delegate callback and released when the callback returns. Nothing here
//    holds a CVPixelBuffer, appends one to an array, or hands one to another
//    queue. The only state that survives a frame is joint coordinates and
//    court metres, in a ring buffer bounded by TIME, so a 45-minute match
//    costs the same memory as a 45-second one.
//
// 2. The work is throttled, not maximal. Vision runs at ~9 Hz because that is
//    the rate the offline pipeline is calibrated at, not because the camera
//    cannot do more. Thermal pressure degrades it further, automatically.
//
// 3. It degrades instead of failing. A denied microphone yields a session with
//    no shot detection rather than no session; a denied camera yields a clear
//    status, not a crash. The screen must always be able to fall back to a
//    human tapping the score.
//
// UNVERIFIED WITHOUT A DEVICE BUILD — say so, do not imply otherwise.
// This environment cannot run xcodebuild, so nothing below has executed on a
// phone. The pure-logic half (LiveReferee.swift, LiveOnset.swift) has been
// compiled and exercised against a synthetic harness off-device; the capture
// wiring here has been typechecked only. Specifically unproven: the Vision
// orientation for each device orientation, real Vision latency at 9 Hz,
// actual battery draw and thermal behaviour over 45 minutes, and whether
// AVCaptureAudioDataOutput's buffers arrive in the format assumed below.

import AVFoundation
import CoreMedia
import CoreVideo
import ExpoModulesCore
import Foundation
import UIKit
import Vision

// MARK: - Status

enum LiveSessionState: String {
  case idle
  case starting
  case running
  case stopped
  case failed
}

/// Why a live session cannot do the thing the screen asked for. Every case is
/// something the UI must be able to render as a sentence, not a stack trace.
enum LiveSessionProblem: String {
  case cameraDenied = "camera-denied"
  case microphoneDenied = "microphone-denied"
  case noCamera = "no-camera"
  case configurationFailed = "configuration-failed"
  case interrupted
}

struct LiveSessionStatus {
  var state: LiveSessionState = .idle
  var cameraAuthorized = false
  var microphoneAuthorized = false
  /// False when the microphone is unavailable: pose still runs and the preview
  /// still shows, but no strikes and no rally ends are emitted, because shot
  /// detection in this project is an AUDIO detector with a pose gate. There is
  /// no measured video-only shot detector to fall back to, so the honest
  /// behaviour is to detect nothing and say so rather than to guess.
  var detectionAvailable = false
  /// True when court corners were supplied. Without them the court filter that
  /// rejects people on adjacent courts and in the gallery cannot run.
  var courtCalibrated = false
  var problem: LiveSessionProblem?
  var thermalState = "nominal"
  var poseHz = 0.0
  /// Pose frames Vision has been run on since the session started.
  var framesProcessed = 0
  /// Frames skipped by the rate throttle — the pipeline working as intended.
  var framesSkipped = 0
  /// Frames where Vision itself threw. A few is normal; a lot means trouble.
  var poseFailures = 0

  var payload: [String: Any] {
    var out: [String: Any] = [
      "state": state.rawValue,
      "cameraAuthorized": cameraAuthorized,
      "microphoneAuthorized": microphoneAuthorized,
      "detectionAvailable": detectionAvailable,
      "courtCalibrated": courtCalibrated,
      "thermalState": thermalState,
      "poseHz": round2(poseHz),
      "framesProcessed": framesProcessed,
      "framesSkipped": framesSkipped,
      "poseFailures": poseFailures,
    ]
    out["problem"] = problem?.rawValue ?? NSNull()
    return out
  }
}

/// Permission state without asking for anything — so a screen can render the
/// right prompt before it triggers a system dialog.
func liveAuthorizationSnapshot() -> [String: Any] {
  func label(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }
  return [
    "camera": label(AVCaptureDevice.authorizationStatus(for: .video)),
    "microphone": label(AVCaptureDevice.authorizationStatus(for: .audio)),
  ]
}

// MARK: - Session

/// The one live session in the process.
///
/// A singleton on purpose, and not for convenience: iOS lets exactly one
/// AVCaptureSession own the camera, and the preview layer the screen shows must
/// be attached to THE session that is doing the analysis. Two sessions — one
/// for expo-camera's preview and one for this — cannot both hold the device.
final class LiveRefereeSession: NSObject {
  static let shared = LiveRefereeSession()

  /// Set by the Expo module; called with (eventName, payload) on a background
  /// queue. Nil when nothing is listening.
  var emit: ((String, [String: Any]) -> Void)?

  private let captureSession = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "racquet.live.session")
  private let videoQueue = DispatchQueue(label: "racquet.live.video")
  private let audioQueue = DispatchQueue(label: "racquet.live.audio")
  /// Guards everything touched by BOTH the video and audio queues: the engine,
  /// the clock origin, and the status counters.
  private let stateLock = NSLock()

  private let videoOutput = AVCaptureVideoDataOutput()
  private let audioOutput = AVCaptureAudioDataOutput()

  // Analysis state. Pose-side objects are only ever touched on videoQueue; the
  // onset detector only on audioQueue; the engine only under stateLock.
  private let poseDetector = PoseDetector()
  private var tracker = TwoTracker()
  private var appearance = TorsoAppearanceSampler()
  private var engine = LiveRallyEngine()
  private var onsetDetector: StreamingOnsetDetector?
  private var homography: Homography?

  private var tuning = LiveRefereeTuning.default
  private var status = LiveSessionStatus()
  private var clockOrigin: Double?
  /// Session time of the audio detector's first sample. Only touched on the
  /// audio queue, alongside `onsetDetector` itself.
  private var audioOrigin: Double?
  private var lastPoseT = -Double.infinity
  /// Effective pose rate, lowered under thermal pressure.
  private var effectivePoseHz = LiveRefereeTuning.default.poseHz

  private override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(thermalStateChanged),
      name: ProcessInfo.thermalStateDidChangeNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(sessionInterrupted),
      name: AVCaptureSession.wasInterruptedNotification,
      object: captureSession
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(sessionInterruptionEnded),
      name: AVCaptureSession.interruptionEndedNotification,
      object: captureSession
    )
  }

  /// The preview layer's session. Read on the main thread by LivePreviewView.
  var previewSession: AVCaptureSession { captureSession }

  var currentStatus: LiveSessionStatus {
    stateLock.lock()
    defer { stateLock.unlock() }
    return status
  }

  // MARK: Permissions

  /// Ask for camera and microphone. Never throws; resolves with what was
  /// granted so the caller can render a denied state instead of an error.
  static func requestPermissions(_ completion: @escaping ([String: Any]) -> Void) {
    AVCaptureDevice.requestAccess(for: .video) { _ in
      AVCaptureDevice.requestAccess(for: .audio) { _ in
        completion(liveAuthorizationSnapshot())
      }
    }
  }

  // MARK: Lifecycle

  /// Configure and start. `cornersJson` may be empty — see `courtCalibrated`.
  /// Completion carries the status; it never carries an exception, because
  /// "the camera is off" is a screen state, not a failure.
  func start(
    cornersJson: String,
    tuningJson: String,
    completion: @escaping (LiveSessionStatus) -> Void
  ) {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      let cameraOK = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
      let micOK = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized

      let parsedTuning = LiveRefereeTuning.parse(tuningJson)
      let mapping = Self.courtMapping(cornersJson: cornersJson)

      self.stateLock.lock()
      self.tuning = parsedTuning
      self.effectivePoseHz = parsedTuning.poseHz
      self.engine = LiveRallyEngine(tuning: parsedTuning)
      self.homography = mapping.homography
      self.clockOrigin = nil
      self.lastPoseT = -.infinity
      self.status = LiveSessionStatus(
        state: .starting,
        cameraAuthorized: cameraOK,
        microphoneAuthorized: micOK,
        detectionAvailable: micOK,
        courtCalibrated: mapping.calibrated,
        problem: nil,
        thermalState: Self.thermalLabel(ProcessInfo.processInfo.thermalState),
        poseHz: parsedTuning.poseHz
      )
      self.stateLock.unlock()
      self.resetPoseState()

      guard cameraOK else {
        self.finishStart(problem: .cameraDenied, state: .failed, completion: completion)
        return
      }
      guard self.configure(withAudio: micOK) else {
        self.finishStart(problem: .configurationFailed, state: .failed, completion: completion)
        return
      }
      if !self.captureSession.isRunning {
        self.captureSession.startRunning()
      }
      self.finishStart(
        problem: micOK ? nil : .microphoneDenied,
        state: .running,
        completion: completion
      )
    }
  }

  func stop(completion: @escaping (LiveSessionStatus) -> Void) {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if self.captureSession.isRunning {
        self.captureSession.stopRunning()
      }
      self.stateLock.lock()
      // Reset rather than retain: a second session must not inherit the first
      // one's open rally, its learned appearance templates, or its clock.
      self.engine.reset()
      self.clockOrigin = nil
      self.lastPoseT = -.infinity
      self.status.state = .stopped
      let snapshot = self.status
      self.stateLock.unlock()
      self.resetPoseState()
      self.onsetDetectorReset()
      self.emitStatus(snapshot)
      completion(snapshot)
    }
  }

  /// Rebuild the tracker and the appearance sampler ON THE VIDEO QUEUE.
  ///
  /// They are read by the pose path without the lock — that path is a hot loop
  /// and single-threaded by construction — so they must also be WRITTEN there.
  /// Reassigning them from the session queue would race with a delegate
  /// callback already in flight when the session stops, and the symptom would
  /// be a rare crash or a silently mis-identified player, not an error.
  private func resetPoseState() {
    videoQueue.async { [weak self] in
      self?.tracker = TwoTracker()
      self?.appearance = TorsoAppearanceSampler()
    }
  }

  private func onsetDetectorReset() {
    audioQueue.async { [weak self] in
      self?.onsetDetector?.reset()
      self?.onsetDetector = nil
      self?.audioOrigin = nil
    }
  }

  private func finishStart(
    problem: LiveSessionProblem?,
    state: LiveSessionState,
    completion: @escaping (LiveSessionStatus) -> Void
  ) {
    stateLock.lock()
    status.state = state
    status.problem = problem
    let snapshot = status
    stateLock.unlock()
    emitStatus(snapshot)
    completion(snapshot)
  }

  // MARK: Configuration

  /// Build the homography from tapped corners, or a fallback that maps the
  /// whole frame onto the court rectangle.
  ///
  /// The fallback is NOT a court fix and must not be described as one. It keeps
  /// downstream maths in consistent units (the tracker's position cost is in
  /// "metres", the ankle gate is in "metres") but it means the court filter in
  /// detectPlayers accepts anyone anywhere in frame — including the players on
  /// the next court and anyone in the gallery. `courtCalibrated: false` is how
  /// the screen learns to ask for four taps.
  private static func courtMapping(cornersJson: String) -> (homography: Homography?, calibrated: Bool) {
    if let data = cornersJson.data(using: .utf8),
       let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      var src: [(x: Double, y: Double)] = []
      var ok = true
      for key in ["frontLeft", "frontRight", "backLeft", "backRight"] {
        guard let pair = raw[key] as? [NSNumber], pair.count == 2 else { ok = false; break }
        src.append((pair[0].doubleValue, pair[1].doubleValue))
      }
      let dst: [(x: Double, y: Double)] = [
        (0, 0), (Court.width, 0), (0, Court.length), (Court.width, Court.length),
      ]
      if ok, let h = Homography.solve4Point(src: src, dst: dst) {
        return (h, true)
      }
    }
    let unit: [(x: Double, y: Double)] = [(0, 0), (1, 0), (0, 1), (1, 1)]
    let dst: [(x: Double, y: Double)] = [
      (0, 0), (Court.width, 0), (0, Court.length), (Court.width, Court.length),
    ]
    return (Homography.solve4Point(src: unit, dst: dst), false)
  }

  private func configure(withAudio: Bool) -> Bool {
    captureSession.beginConfiguration()
    defer { captureSession.commitConfiguration() }

    // 1280x720 is a compromise, chosen and stated rather than defaulted into:
    // Vision needs enough pixels to find a player at the back wall, and every
    // pixel above that is battery. Untested against 1080p on a real court.
    if captureSession.canSetSessionPreset(.hd1280x720) {
      captureSession.sessionPreset = .hd1280x720
    } else if captureSession.canSetSessionPreset(.high) {
      captureSession.sessionPreset = .high
    }

    for input in captureSession.inputs {
      captureSession.removeInput(input)
    }
    for output in captureSession.outputs {
      captureSession.removeOutput(output)
    }

    guard let camera = AVCaptureDevice.default(
      .builtInWideAngleCamera, for: .video, position: .back
    ) ?? AVCaptureDevice.default(for: .video) else {
      return false
    }
    guard let cameraInput = try? AVCaptureDeviceInput(device: camera),
          captureSession.canAddInput(cameraInput) else {
      return false
    }
    captureSession.addInput(cameraInput)

    videoOutput.videoSettings = [
      // 32BGRA because TorsoAppearanceSampler reads shirt colour straight out
      // of the buffer and refuses any other format.
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    // The single most important line for rule 1: when the video queue is busy
    // with a Vision request, late frames are DROPPED, not queued. Without it a
    // slow frame builds an unbounded backlog of retained buffers.
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
    guard captureSession.canAddOutput(videoOutput) else { return false }
    captureSession.addOutput(videoOutput)
    applyRotation()

    if withAudio {
      if let mic = AVCaptureDevice.default(for: .audio),
         let micInput = try? AVCaptureDeviceInput(device: mic),
         captureSession.canAddInput(micInput) {
        captureSession.addInput(micInput)
        audioOutput.setSampleBufferDelegate(self, queue: audioQueue)
        if captureSession.canAddOutput(audioOutput) {
          captureSession.addOutput(audioOutput)
        }
      } else {
        // The permission was granted but the device is not usable (a call is
        // in progress, say). Pose still runs; shots do not.
        stateLock.lock()
        status.detectionAvailable = false
        status.problem = .microphoneDenied
        stateLock.unlock()
      }
    }
    return true
  }

  /// Ask AVFoundation to deliver upright buffers, so Vision can be handed
  /// `.up` and the orientation guesswork disappears from the analysis path.
  private func applyRotation() {
    guard let connection = videoOutput.connection(with: .video) else { return }
    let angle = Self.rotationAngle(for: UIDevice.current.orientation)
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(angle) {
        connection.videoRotationAngle = angle
      }
    } else if connection.isVideoOrientationSupported {
      connection.videoOrientation = Self.legacyOrientation(for: UIDevice.current.orientation)
    }
  }

  /// Clockwise degrees to rotate the buffer so it is upright.
  private static func rotationAngle(for orientation: UIDeviceOrientation) -> CGFloat {
    switch orientation {
    case .landscapeLeft: return 180
    case .landscapeRight: return 0
    case .portraitUpsideDown: return 270
    default: return 90 // portrait, and anything face-up/unknown
    }
  }

  private static func legacyOrientation(
    for orientation: UIDeviceOrientation
  ) -> AVCaptureVideoOrientation {
    switch orientation {
    case .landscapeLeft: return .landscapeRight
    case .landscapeRight: return .landscapeLeft
    case .portraitUpsideDown: return .portraitUpsideDown
    default: return .portrait
    }
  }

  /// Re-apply the capture rotation after the device turns. Called from JS on
  /// an orientation change; cheap, and safe to call when nothing has moved.
  func refreshOrientation() {
    sessionQueue.async { [weak self] in
      self?.applyRotation()
    }
  }

  // MARK: Thermals

  private static func thermalLabel(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }

  /// Thermal pressure lowers the pose rate rather than letting iOS throttle the
  /// whole app. A referee that gets slower is usable; one the OS decides to
  /// stop is not.
  ///
  /// ESTIMATE, NOT MEASUREMENT: the step sizes below are chosen for shape, not
  /// fitted to any thermal trace. Vision body pose on one 720p frame is the
  /// dominant cost in this pipeline, so cutting the rate roughly halves that
  /// cost each step, but the actual sustainable rate for a 45-minute match on
  /// a given phone has not been measured here and needs a device to establish.
  @objc private func thermalStateChanged() {
    let state = ProcessInfo.processInfo.thermalState
    stateLock.lock()
    let base = tuning.poseHz
    switch state {
    case .serious: effectivePoseHz = max(4, base * 0.6)
    case .critical: effectivePoseHz = max(3, base * 0.4)
    default: effectivePoseHz = base
    }
    status.thermalState = Self.thermalLabel(state)
    status.poseHz = effectivePoseHz
    let snapshot = status
    stateLock.unlock()
    emitStatus(snapshot)
  }

  @objc private func sessionInterrupted() {
    stateLock.lock()
    status.problem = .interrupted
    let snapshot = status
    stateLock.unlock()
    emitStatus(snapshot)
  }

  @objc private func sessionInterruptionEnded() {
    stateLock.lock()
    if status.problem == .interrupted { status.problem = nil }
    let snapshot = status
    stateLock.unlock()
    emitStatus(snapshot)
  }

  // MARK: Emission

  private func emitStatus(_ snapshot: LiveSessionStatus) {
    var payload = snapshot.payload
    payload["tuning"] = tuningPayload()
    emit?("liveRefereeStatus", payload)
  }

  private func tuningPayload() -> [String: Any] {
    stateLock.lock()
    defer { stateLock.unlock() }
    return tuning.payload
  }

  private func dispatch(_ events: [LiveRefereeEvent]) {
    guard !events.isEmpty, let emit else { return }
    for event in events {
      switch event {
      case .rallyStarted(let e): emit("liveRallyStarted", e.payload)
      case .strike(let e): emit("liveStrike", e.payload)
      case .rallyEnded(let e): emit("liveRallyEnded", e.payload)
      }
    }
  }

  /// Session-relative seconds, with the origin pinned to the first buffer seen
  /// on EITHER output — video and audio share the capture session's clock, so
  /// one origin keeps the two streams on one timeline.
  private func sessionTime(_ pts: CMTime) -> Double? {
    let seconds = CMTimeGetSeconds(pts)
    guard seconds.isFinite else { return nil }
    stateLock.lock()
    defer { stateLock.unlock() }
    if clockOrigin == nil { clockOrigin = seconds }
    return seconds - (clockOrigin ?? seconds)
  }
}

// MARK: - Capture callbacks

extension LiveRefereeSession: AVCaptureVideoDataOutputSampleBufferDelegate,
                              AVCaptureAudioDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output === videoOutput {
      handleVideo(sampleBuffer)
    } else if output === audioOutput {
      handleAudio(sampleBuffer)
    }
  }

  // MARK: Video

  private func handleVideo(_ sampleBuffer: CMSampleBuffer) {
    guard let t = sessionTime(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) else { return }

    stateLock.lock()
    let hz = effectivePoseHz
    let due = t - lastPoseT >= 1.0 / max(hz, 0.5)
    if due { lastPoseT = t } else { status.framesSkipped += 1 }
    let h = homography
    stateLock.unlock()

    guard due else {
      // Not a pose frame — but time still has to move, or the silence timer
      // would never fire while the microphone is quiet.
      dispatch(withEngine { $0.tick(now: t) })
      return
    }
    guard let homography = h else { return }

    // Everything that touches the pixel buffer happens inside this pool and
    // inside this call. Nothing escapes it. See rule 1 in the file header.
    autoreleasepool {
      guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
      let width = Double(CVPixelBufferGetWidth(pixelBuffer))
      let height = Double(CVPixelBufferGetHeight(pixelBuffer))
      guard width > 0, height > 0 else { return }

      // The connection delivers upright buffers (applyRotation), so Vision
      // gets .up and the joint coordinates are already in upright pixels.
      let poses: [[String: JointPoint]]
      do {
        poses = try poseDetector.detect(
          pixelBuffer: pixelBuffer,
          orientation: .up,
          uprightWidth: width,
          uprightHeight: height
        )
      } catch {
        // One bad frame is "nobody seen this frame", never the end of a match.
        stateLock.lock()
        status.poseFailures += 1
        stateLock.unlock()
        return
      }

      var dets = detectPlayers(
        rawPoses: poses, homography: homography, width: width, height: height
      )
      // Read the shirts while the frame is still in hand — the tracker needs
      // them to keep A and B apart through a crossing, and this is the last
      // moment the pixels exist.
      appearance.describe(
        &dets,
        pixelBuffer: pixelBuffer,
        orientation: .up,
        uprightWidth: width,
        uprightHeight: height
      )
      let tracked = tracker.update(dets, t: t)

      stateLock.lock()
      status.framesProcessed += 1
      stateLock.unlock()

      dispatch(withEngine { $0.addPoseFrame(t: t, players: tracked) })
    }
  }

  // MARK: Audio

  private func handleAudio(_ sampleBuffer: CMSampleBuffer) {
    guard let t = sessionTime(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) else { return }
    guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee else {
      return
    }
    let sampleRate = asbd.mSampleRate
    guard sampleRate > 0 else { return }

    if onsetDetector == nil {
      // Built from the FIRST buffer's format rather than an assumed rate: the
      // envelope's window and hop are defined in seconds, so the detector is
      // correct at whatever rate the hardware hands over. No resampling, and
      // therefore no resampling bugs.
      onsetDetector = StreamingOnsetDetector(sampleRate: sampleRate)
      // The detector counts seconds from its own first sample; this is where
      // that zero sits on the session clock. Sample-counted time inside the
      // detector plus this origin gives a timestamp directly comparable with
      // the pose frames', which is the whole reason audio runs through the
      // capture session rather than through a separate AVAudioEngine.
      audioOrigin = t
    }
    guard let detector = onsetDetector else { return }
    let origin = audioOrigin ?? t

    autoreleasepool {
      guard let mono = Self.monoSamples(from: sampleBuffer, asbd: asbd) else { return }
      var onsets: [LiveOnset] = []
      // No explicit flush: consume() releases held candidates on every
      // envelope frame, and audio keeps flowing for as long as the session
      // runs, so a candidate is never stranded.
      detector.append(samples: mono) { onsets.append($0) }
      var events: [LiveRefereeEvent] = []
      for onset in onsets {
        let shifted = LiveOnset(t: onset.t + origin, strength: onset.strength)
        events.append(contentsOf: withEngine { $0.addOnset(shifted) })
      }
      dispatch(events)
    }
  }

  /// Interleaved or planar PCM out of a CMSampleBuffer, downmixed to mono
  /// Float. Handles the two formats iOS actually delivers (32-bit float and
  /// 16-bit signed int) and refuses anything else rather than reinterpreting
  /// bytes it does not understand.
  private static func monoSamples(
    from sampleBuffer: CMSampleBuffer,
    asbd: AudioStreamBasicDescription
  ) -> [Float]? {
    guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return nil }
    let byteLength = CMBlockBufferGetDataLength(block)
    guard byteLength > 0 else { return nil }
    var raw = [UInt8](repeating: 0, count: byteLength)
    let status = raw.withUnsafeMutableBytes { buffer -> OSStatus in
      guard let base = buffer.baseAddress else { return kCMBlockBufferBadPointerParameterErr }
      return CMBlockBufferCopyDataBytes(
        block, atOffset: 0, dataLength: byteLength, destination: base
      )
    }
    guard status == kCMBlockBufferNoErr else { return nil }

    let channels = max(Int(asbd.mChannelsPerFrame), 1)
    let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
    let isInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0

    if isFloat && asbd.mBitsPerChannel == 32 {
      let count = byteLength / MemoryLayout<Float>.size
      guard count > 0 else { return nil }
      let values = raw.withUnsafeBytes { Array($0.bindMemory(to: Float.self).prefix(count)) }
      return downmix(values, channels: channels, interleaved: isInterleaved)
    }
    if !isFloat && asbd.mBitsPerChannel == 16 {
      let count = byteLength / MemoryLayout<Int16>.size
      guard count > 0 else { return nil }
      let values = raw.withUnsafeBytes {
        $0.bindMemory(to: Int16.self).prefix(count).map { Float($0) / 32768.0 }
      }
      return downmix(Array(values), channels: channels, interleaved: isInterleaved)
    }
    return nil
  }

  private static func downmix(_ values: [Float], channels: Int, interleaved: Bool) -> [Float] {
    guard channels > 1 else { return values }
    let frames = values.count / channels
    guard frames > 0 else { return [] }
    var out = [Float](repeating: 0, count: frames)
    if interleaved {
      for f in 0..<frames {
        var acc: Float = 0
        for c in 0..<channels { acc += values[f * channels + c] }
        out[f] = acc / Float(channels)
      }
    } else {
      // Planar: channel 0 alone. Mixing planes would need the real per-plane
      // strides from the block buffer's layout, and a squash microphone is
      // effectively mono anyway.
      for f in 0..<frames { out[f] = values[f] }
    }
    return out
  }

  /// Run a closure against the engine under the lock. Both capture queues call
  /// into the engine, and it is explicitly not thread-safe.
  private func withEngine(_ body: (LiveRallyEngine) -> [LiveRefereeEvent]) -> [LiveRefereeEvent] {
    stateLock.lock()
    defer { stateLock.unlock() }
    return body(engine)
  }
}

// MARK: - Preview

/// Camera preview bound to the analysis session.
///
/// It has no capture session of its own — it borrows LiveRefereeSession's,
/// because iOS will not give the camera to two sessions at once. That is why
/// the live referee screen cannot simply put an expo-camera view on top.
public final class LivePreviewView: ExpoView {
  public override class var layerClass: AnyClass {
    AVCaptureVideoPreviewLayer.self
  }

  private var previewLayer: AVCaptureVideoPreviewLayer {
    // swiftlint:disable:next force_cast
    layer as! AVCaptureVideoPreviewLayer
  }

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    previewLayer.videoGravity = .resizeAspectFill
    previewLayer.session = LiveRefereeSession.shared.previewSession
  }

  /// "cover" (default) or "contain".
  func setGravity(_ value: String) {
    previewLayer.videoGravity = value == "contain" ? .resizeAspect : .resizeAspectFill
  }
}
