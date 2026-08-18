#!/bin/sh
# Exercise the live referee's pure logic off-device.
#
# The capture wiring (LiveSession.swift) needs a phone. The two files that
# actually DECIDE anything — LiveOnset.swift's streaming onset picker and
# LiveReferee.swift's rally state machine — do not, and this compiles them
# against a synthetic match and prints what they emit.
#
# Deliberately NOT inside ios/: the podspec globs '**/*.{h,m,mm,swift}' from
# there, and main.swift's top-level code would be swept into the app build.
#
# What it checks:
#   - a scripted rally produces exactly one rally-start and one rally-end;
#   - onsets during a break, with both players idle, are gated out (the pass-2
#     rally-activity gate that lifted offline shot precision from 41% to 71%);
#   - a break that is really a run of MISSED shots — players still moving at
#     rally pace, the archive_match2 t=94.4 case — lands in the "ask" band and
#     says so in its `why`, instead of proposing a point confidently;
#   - confidence never exceeds the measured oracle ceiling (0.727);
#   - the streaming onset detector finds the same strikes as the offline batch
#     detector in Audio.swift on the same signal.
#
# Usage: sh modules/racquet-analyzer/checks/run.sh
set -e

here=$(cd "$(dirname "$0")" && pwd)
ios="$here/../ios"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

# -suppress-warnings: Audio.swift is compiled here only for its batch onset
# picker, and its AVAsset calls are deprecated on macOS but not on iOS, where
# the file actually ships.
xcrun swiftc -O -suppress-warnings -o "$out/liveharness" \
  "$ios/Stats.swift" \
  "$ios/Homography.swift" \
  "$ios/Audio.swift" \
  "$ios/LiveOnset.swift" \
  "$ios/LiveReferee.swift" \
  "$here/main.swift"

"$out/liveharness"
