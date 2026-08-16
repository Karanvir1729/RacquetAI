// REAL PIPELINE OUTPUT — generated from analysis/out/archive_match2/analysis.json
/**
 * Demo match analysis behind the Library's "Sample" card.
 *
 * REAL output of the v0 pipeline (analysis/analyze.py, v2 gating) on a real
 * 7.5-minute club squash match: https://archive.org/details/0-c-0-ecc-7-c-2356-4037-b-4-a-7-d-24271393070 (file 48242105-EC60-4EB9-BDA7-7DBD510DD248.mp4)
 * (CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/) — validation footage, not shipped).
 *
 * Audio-based shot detection with player-activity gating, venue-tuned 5s
 * rally split, 78.7% both-player pose detection. Shots list trimmed to
 * the first 40 for bundle size.
 */
import type { MatchAnalysis } from "./types";

export const DEMO_ANALYSIS: MatchAnalysis = {
  schemaVersion: 1,
  video: {
    source: "https://archive.org/details/0-c-0-ecc-7-c-2356-4037-b-4-a-7-d-24271393070 (file 48242105-EC60-4EB9-BDA7-7DBD510DD248.mp4)",
    license: "CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)",
    durationSec: 451.45,
    fps: 29.97,
    width: 854,
    height: 480,
  },
  court: {
    gridRows: 2,
    gridCols: 2,
  },
  players: [
    {
      id: "A",
      label: "Player A",
      shots: 153,
      placement: {
        frontLeft: 11,
        frontRight: 14,
        backLeft: 66,
        backRight: 62,
      },
      coverageHeatmap: {
        rows: 12,
        cols: 8,
        values: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0033, 0.0099, 0.0, 0.0, 0.0066, 0.0132, 0.0164, 0.0099, 0.0066, 0.0197, 0.0, 0.0296, 0.023, 0.0033, 0.0, 0.0066, 0.0164, 0.0329, 0.0, 0.0724, 0.0296, 0.0, 0.0, 0.0099, 0.0099, 0.0362, 0.0, 0.0954, 0.0625, 0.023, 0.0, 0.0099, 0.0164, 0.0428, 0.0033, 0.0461, 0.1414, 0.102, 0.0362, 0.0428, 0.0724, 0.1151, 0.0, 0.0888, 0.1316, 0.1184, 0.1086, 0.1184, 0.0789, 0.2072, 0.0197, 0.0625, 0.1546, 0.2072, 0.4934, 0.1678, 0.102, 0.1217, 0.0362, 0.1941, 0.4178, 0.5493, 0.6842, 0.227, 0.2072, 0.1875, 0.0691, 0.1842, 1.0, 0.3882, 0.2928, 0.2434, 0.1776, 0.1711, 0.0099, 0.1151, 0.2895, 0.1513, 0.1283, 0.1809, 0.0954, 0.2072, 0.0, 0.0, 0.0066, 0.0164, 0.023, 0.023, 0.0197, 0.0888],
      },
      tTimePct: 23.5,
      predictability: {
        score: 0.259,
        entropyBits: 1.482,
        maxEntropyBits: 2.0,
        topPattern: "backRight -> backRight (24%)",
      },
    },
    {
      id: "B",
      label: "Player B",
      shots: 160,
      placement: {
        frontLeft: 13,
        frontRight: 14,
        backLeft: 67,
        backRight: 66,
      },
      coverageHeatmap: {
        rows: 12,
        cols: 8,
        values: [0.0, 0.0117, 0.0146, 0.0117, 0.0117, 0.0087, 0.0087, 0.0087, 0.0117, 0.0029, 0.0, 0.0, 0.0, 0.0029, 0.0292, 0.0029, 0.0058, 0.0, 0.0, 0.0, 0.0, 0.0087, 0.0087, 0.0029, 0.0146, 0.0, 0.0, 0.0, 0.0, 0.0058, 0.0058, 0.0, 0.0262, 0.0292, 0.0233, 0.0233, 0.0175, 0.0058, 0.0058, 0.0058, 0.0379, 0.0729, 0.0496, 0.035, 0.0146, 0.0379, 0.0321, 0.1195, 0.0554, 0.1312, 0.0904, 0.0991, 0.0904, 0.0671, 0.0437, 0.2274, 0.0146, 0.1603, 0.2187, 0.3236, 0.449, 0.1749, 0.0933, 0.0583, 0.0175, 0.1108, 0.5102, 0.5918, 0.5598, 0.309, 0.1603, 0.1691, 0.0146, 0.2857, 1.0, 0.2653, 0.0845, 0.1983, 0.2099, 0.1312, 0.0087, 0.1429, 0.3469, 0.1487, 0.0641, 0.0904, 0.1662, 0.1458, 0.0, 0.0146, 0.0292, 0.0496, 0.0496, 0.0292, 0.0437, 0.0379],
      },
      tTimePct: 24.0,
      predictability: {
        score: 0.22,
        entropyBits: 1.56,
        maxEntropyBits: 2.0,
        topPattern: "backRight -> backRight (23%)",
      },
    },
  ],
  rallies: {
    count: 16,
    avgShotsPerRally: 20.56,
    longestRally: 59,
  },
  shots: [
    {
      tSec: 0.98,
      player: "A",
      cell: "frontRight",
    },
    {
      tSec: 1.65,
      player: "B",
      cell: "frontRight",
    },
    {
      tSec: 2.28,
      player: "A",
      cell: "frontLeft",
    },
    {
      tSec: 3.02,
      player: "B",
      cell: "frontLeft",
    },
    {
      tSec: 3.83,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 4.27,
      player: "B",
      cell: "frontRight",
    },
    {
      tSec: 4.81,
      player: "A",
      cell: "frontRight",
    },
    {
      tSec: 8.1,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 8.68,
      player: "A",
      cell: "frontRight",
    },
    {
      tSec: 12.93,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 14.05,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 14.79,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 15.51,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 16.81,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 17.25,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 17.65,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 18.62,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 19.34,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 30.42,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 31.46,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 31.83,
      player: "A",
      cell: "frontLeft",
    },
    {
      tSec: 33.62,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 37.87,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 38.66,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 39.2,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 40.36,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 41.26,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 41.63,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 42.4,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 42.84,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 43.84,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 44.98,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 45.77,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 46.28,
      player: "A",
      cell: "backLeft",
    },
    {
      tSec: 47.51,
      player: "B",
      cell: "frontLeft",
    },
    {
      tSec: 48.3,
      player: "B",
      cell: "backLeft",
    },
    {
      tSec: 49.92,
      player: "B",
      cell: "backRight",
    },
    {
      tSec: 50.71,
      player: "B",
      cell: "frontLeft",
    },
    {
      tSec: 51.11,
      player: "A",
      cell: "backRight",
    },
    {
      tSec: 52.5,
      player: "A",
      cell: "backRight",
    },
  ],
  quality: {
    framesAnalyzed: 3383,
    bothPlayersDetectedPct: 78.7,
    audioAvailable: true,
    notes: [
      "235 audio onsets rejected by the player-activity gate (likely neighbouring courts, voices or bounces)",
      "rally split gap set to 5.0s for this venue (default 8.0s; serve turnarounds here are ~5s)",
      "564 onsets detected, 329 attributed to a striker, 329 inside rallies, 313 placed via retrieval proxy",
    ],
  },
};
