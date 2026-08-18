// LiveOnset.swift — the streaming half of Audio.swift.
//
// The offline detector is a batch algorithm: it decodes the whole track, takes
// the median and the 95th percentile of the WHOLE clip for the height floor,
// and slides a CENTRED +/-1 s window for the median/MAD threshold. A live
// referee has neither the whole clip nor the future, so this file re-states the
// same arithmetic over bounded ring buffers.
//
// What is identical to Audio.swift, deliberately:
//   - the RMS envelope: 20 ms window, 10 ms hop (AnalyzerParams.audioWinS/HopS);
//   - the local-maximum test v[i] >= v[i-1] && v[i] >= v[i+1] (one hop of
//     lookahead, 10 ms);
//   - the adaptive threshold median + onsetMadK * MAD;
//   - the merge: onsets closer than onsetMergeS collapse, stronger peak wins.
//
// What differs, and why — these are the honest deltas, not tuning:
//   1. The height floor (med + 1.0*(p95 - med)) is computed over a ROLLING
//      window of the last `floorWindowS` seconds instead of the whole clip.
//      Live, that is strictly better than a clip constant: a squash venue's
//      noise floor changes when the court next door starts a match, and the
//      offline constant would then be wrong for the rest of the session.
//   2. The median/MAD window is TRAILING (the last 2 * onsetMedianHalfWinS
//      seconds) rather than centred. Centring would cost a full second of
//      latency on every strike. The two agree wherever the noise floor is
//      locally stationary and disagree at a step change, where the trailing
//      form reacts a beat late.
//   NEITHER delta has been measured against the offline stream on real
//   footage — there is no live capture to measure it with in this environment.
//   Treat the live onset stream as "the same algorithm, not the same numbers".
//
// Memory: two fixed-capacity ring buffers plus one partial-window sample
// accumulator. Nothing here grows with session length, which is the whole
// point — this runs for 45 minutes.

import Foundation

/// One picked onset, in the capture session's own clock.
struct LiveOnset {
  /// Seconds since the session's first audio sample.
  let t: Double
  /// The envelope value at the peak — how loud the strike was, in the same
  /// units as the threshold it beat. Carried through so a downstream gate can
  /// tell a racquet from a shoe squeak.
  let strength: Double
}

/// Fixed-capacity circular buffer of Doubles. Bounded by construction: writing
/// past the end overwrites the oldest value, so a 45-minute session costs the
/// same bytes as a 45-second one.
struct RingBufferD {
  private var storage: [Double]
  private var head = 0
  private(set) var count = 0

  init(capacity: Int) {
    storage = [Double](repeating: 0, count: max(1, capacity))
  }

  var capacity: Int { storage.count }

  mutating func append(_ value: Double) {
    storage[head] = value
    head = (head + 1) % storage.count
    if count < storage.count { count += 1 }
  }

  /// Oldest-first snapshot. Allocates; call it on the rare path (a candidate
  /// peak), never per hop.
  func snapshot() -> [Double] {
    guard count > 0 else { return [] }
    var out = [Double]()
    out.reserveCapacity(count)
    let start = (head - count + storage.count) % storage.count
    for i in 0..<count {
      out.append(storage[(start + i) % storage.count])
    }
    return out
  }

  /// The most recent `n` values, oldest-first. Cheaper than snapshot() when
  /// only the tail is wanted.
  func tail(_ n: Int) -> [Double] {
    let take = min(n, count)
    guard take > 0 else { return [] }
    var out = [Double]()
    out.reserveCapacity(take)
    let start = (head - take + storage.count) % storage.count
    for i in 0..<take {
      out.append(storage[(start + i) % storage.count])
    }
    return out
  }

  mutating func removeAll() {
    head = 0
    count = 0
  }
}

/// Streaming RMS envelope + onset picker. Feed it mono float samples in
/// capture order; it calls back with onsets, `onsetMergeS` late (the merge
/// cannot know a louder peak is coming without waiting for it).
///
/// Not thread-safe on its own — LiveRefereeSession only ever feeds it from the
/// audio callback queue.
final class StreamingOnsetDetector {
  /// How far back the height floor looks. Long enough that a single rally
  /// cannot drag the floor up under itself, short enough to follow the venue.
  static let floorWindowS = 30.0
  /// Envelope frames between recomputes of the (expensive) floor statistics.
  /// 100 hops = 1 s.
  static let floorRefreshHops = 100

  private let sampleRate: Double
  private let hopSamples: Int
  private let winSamples: Int

  /// Partial-window carry: samples not yet consumed by a window start.
  private var pending: [Float] = []
  /// Index (in samples) of `pending[0]` within the session's audio stream.
  private var pendingStartSample = 0

  /// Recent envelope values for the rolling height floor.
  private var floorRing: RingBufferD
  /// Recent envelope values for the trailing median/MAD threshold.
  private var thresholdRing: RingBufferD
  private let thresholdSamplesWanted: Int

  /// The last three envelope values, for the local-maximum test.
  private var prev2: Double?
  private var prev1: Double?
  private var prev1T: Double = 0

  private var hopsSinceFloor = StreamingOnsetDetector.floorRefreshHops
  private var heightFloor = Double.infinity
  /// True once the floor has been computed from a usefully long window; before
  /// that the detector emits nothing rather than emitting garbage.
  private(set) var warmedUp = false
  private let warmupHops: Int
  private var hopsSeen = 0

  /// Candidate held back so a louder peak inside onsetMergeS can replace it.
  private var heldCandidate: LiveOnset?

  init(sampleRate: Double) {
    self.sampleRate = max(sampleRate, 1)
    hopSamples = max(1, Int(AnalyzerParams.audioHopS * self.sampleRate))
    winSamples = max(hopSamples, Int(AnalyzerParams.audioWinS * self.sampleRate))
    let hopsPerSecond = 1.0 / AnalyzerParams.audioHopS
    floorRing = RingBufferD(capacity: Int(Self.floorWindowS * hopsPerSecond))
    thresholdSamplesWanted = max(3, Int(2.0 * AnalyzerParams.onsetMedianHalfWinS * hopsPerSecond))
    thresholdRing = RingBufferD(capacity: thresholdSamplesWanted)
    // 3 s of envelope before the floor means anything. A squash court is never
    // silent for 3 s at the start of a session, and if it is, the floor is low
    // and the first real strike clears it comfortably.
    warmupHops = Int(3.0 * hopsPerSecond)
    pending.reserveCapacity(winSamples + hopSamples)
  }

  /// Feed one buffer of mono float samples. `onOnset` fires zero or more times.
  func append(samples: [Float], onOnset: (LiveOnset) -> Void) {
    guard !samples.isEmpty else { return }
    pending.append(contentsOf: samples)
    while pending.count >= winSamples {
      var acc = 0.0
      for i in 0..<winSamples {
        let v = Double(pending[i])
        acc += v * v
      }
      let rms = (acc / Double(winSamples)).squareRoot()
      // Window CENTRE, matching rmsEnvelope's timestamp convention exactly.
      let t = (Double(pendingStartSample) + Double(winSamples) / 2.0) / sampleRate
      consume(value: rms, t: t, onOnset: onOnset)
      pending.removeFirst(hopSamples)
      pendingStartSample += hopSamples
    }
  }

  /// Flush any candidate whose merge window has closed. Driven by wall time so
  /// the last strike of a rally is not held hostage by silence.
  func flush(now: Double, onOnset: (LiveOnset) -> Void) {
    if let held = heldCandidate, now - held.t >= AnalyzerParams.onsetMergeS {
      heldCandidate = nil
      onOnset(held)
    }
  }

  func reset() {
    pending.removeAll(keepingCapacity: true)
    pendingStartSample = 0
    floorRing.removeAll()
    thresholdRing.removeAll()
    prev1 = nil
    prev2 = nil
    heldCandidate = nil
    hopsSinceFloor = Self.floorRefreshHops
    heightFloor = .infinity
    warmedUp = false
    hopsSeen = 0
  }

  // MARK: - Internals

  private func consume(value: Double, t: Double, onOnset: (LiveOnset) -> Void) {
    floorRing.append(value)
    thresholdRing.append(value)
    hopsSeen += 1
    // Saturating, not wrapping: this counter runs for 45 minutes.
    hopsSinceFloor = min(hopsSinceFloor + 1, Self.floorRefreshHops)
    if hopsSinceFloor >= Self.floorRefreshHops && hopsSeen >= warmupHops {
      refreshFloor()
    }

    // The local-max test needs the value AFTER the peak, so the frame under
    // test is prev1 and `value` is its right neighbour — one hop (10 ms) of
    // latency, the same test Audio.swift makes with the whole array in hand.
    defer {
      prev2 = prev1
      prev1 = value
      prev1T = t
    }
    // The merge window may have closed on a candidate even if this frame is
    // not itself a peak.
    flush(now: t, onOnset: onOnset)

    guard warmedUp, let candidate = prev1, let left = prev2 else { return }
    guard candidate >= left, candidate >= value else { return }
    guard candidate > heightFloor else { return }

    // Expensive, so it runs only for frames that already cleared the floor —
    // a handful per second at most, not 100.
    let window = thresholdRing.tail(thresholdSamplesWanted)
    guard window.count >= 3 else { return }
    let med = median(window)
    let mad = median(window.map { abs($0 - med) })
    guard candidate > med + AnalyzerParams.onsetMadK * max(mad, 1e-9) else { return }

    let onset = LiveOnset(t: prev1T, strength: candidate)
    if let held = heldCandidate {
      if onset.t - held.t < AnalyzerParams.onsetMergeS {
        // Same strike heard twice: keep the louder, exactly as the offline
        // merge does.
        if onset.strength > held.strength { heldCandidate = onset }
        return
      }
      heldCandidate = onset
      onOnset(held)
      return
    }
    heldCandidate = onset
  }

  private func refreshFloor() {
    let values = floorRing.snapshot()
    guard values.count >= 3 else { return }
    let med = median(values)
    let p95 = percentile(values, 95)
    heightFloor = med + 1.0 * (p95 - med)
    hopsSinceFloor = 0
    warmedUp = true
  }
}
