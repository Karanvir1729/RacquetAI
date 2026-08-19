#!/usr/bin/env python3
"""Collect every measured number for the ball-detection lane into one file."""
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = os.path.join(REPO, "eval")


def rd(n):
    p = os.path.join(E, n)
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    det = rd("ball_detector_results.json")
    out = {
        "schema": "ball_detection_v1",
        "date": "2026-08-18",
        "groundTruth": {
            "file": "eval/ball_labels_v1.json",
            "labelledFrames": 156, "humanVisible": 59,
            "fairFrames": 84, "cleanNullFrames": 48,
            "note": "recall is denominated in the 59 frames a human could see "
                    "the ball in; a detector cannot find what is behind a body",
        },
        "biasDisclosures": [
            "Labels were placed with a 3-frame difference aid, and every "
            "detector here is built on that same difference, so RECALL is an "
            "optimistic ceiling. False-positive rates are unbiased -- the "
            "labeller never enumerated non-ball movers.",
            "Hand filter thresholds (area, extent, darkness, elongation) were "
            "chosen from these labels' own feature statistics, so detectors A, "
            "A', B and B2 are tuned on test.",
            "Detector L is reported under leave-one-segment-out; L' is the same "
            "model graded in-sample and is shown only to size the optimism.",
            "eval/ball_nested_cv.json is the only figure with NOTHING about the "
            "held-out segment used -- weights and threshold are both chosen on "
            "the other 12 segments.",
        ],
        "candidateGenerator": {
            "ballInCandidateSet": [54, 59],
            "medianRankOfTrueBall": 2, "p90Rank": 10,
            "candidatesPerFrame": 159,
            "generatorMisses": 5,
            "generatorMissCause": "all five are motion-blur streaks",
            "conclusion": "generation is not the bottleneck; RANKING is",
        },
        "nestedCV": rd("ball_nested_cv.json"),
        "chanceControl": {
            "test": "labels permuted within segment, 2000 draws",
            "tol8": {"observed": 28, "nullMean": 7.66, "p": "<0.0005"},
            "tol5": {"observed": 24, "nullMean": 4.09, "p": "<0.0005"},
            "note": "detections are far above chance, but a 8 px disc around a "
                    "2-3 px ball earns ~13% by chance, so the 5 px figure is "
                    "the one to quote",
        },
        "resolution": {
            "detectorLadder": rd("ball_detector_ladder.json"),
            "hiresComparison": {
                "conditions": ["mp4_480", "hires_480 (encode control)",
                               "hires_1080"],
                "ballInCandSet": ["22/25", "22/25", "21/25"],
                "pairedTest": "1080p found 0 frames that 480p missed; "
                              "exact p=1.000",
                "sample": "25 labelled-visible frames, 3 segments, one clip",
                "conclusion": "resolution does NOT help this detector, which is "
                              "the opposite of its effect on the human labeller "
                              "(8/12 -> 12/12). The human was perception-limited; "
                              "the detector is discrimination-limited, and more "
                              "pixels buy signal, not separability.",
            },
        },
        "bounceReadiness": {
            "detections": 28, "runs": 8,
            "runLengthHistogram": {"1": 2, "2": 2, "3": 2, "5": 1, "11": 1},
            "runsGE3": 4, "runsGE6": 1,
            "visibleByBackground": {"frontWall": 36, "floor": 16, "sideWall": 3,
                                    "glass": 2, "mullion": 1, "redLine": 1},
            "conclusion": "a bounce is found by fitting motion either side of an "
                          "instant, which needs a run of >=6 frames spanning it. "
                          "Across 84 frames of live play exactly ONE such run "
                          "exists, and it is on the front wall, not the floor.",
        },
        "verdict": "NOT FEASIBLE for the events the product needs (floor "
                   "bounces, landing point, two-bounce refereeing). Ball "
                   "detection itself is real and well above chance, but it "
                   "arrives too sparsely and too unevenly to time an instant.",
        "detectorCurves": {k: (v[-1] if isinstance(v, list) and v else v)
                           for k, v in (det or {}).items()},
    }
    p = os.path.join(E, "ball_detection_findings.json")
    json.dump(out, open(p, "w"), indent=1, default=float)
    print("wrote", p)


if __name__ == "__main__":
    main()
