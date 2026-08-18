/**
 * The tutorial's content, separated from its presentation so the copy can be
 * read and edited as prose.
 *
 * Ordering is deliberate: filming and corner-marking come before anything
 * about reading results, because those two steps are the only ones where a
 * user can silently ruin an analysis. Everything downstream — placement,
 * coverage, predictability — is computed off the court model those steps
 * establish, and a phone that moved mid-match or four corners tapped loosely
 * produce confident-looking numbers that are wrong.
 */
import { Ionicons } from "@expo/vector-icons";

export interface TutorialStep {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One-line framing under the title. */
  lead: string;
  /** Body points. Keep each to a single idea — they render as a checklist. */
  points: readonly string[];
  /** Optional caution rendered apart from the points, for the failure modes. */
  caution?: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    icon: "analytics",
    title: "What RacquetIQ does",
    lead: "It watches your squash match and tells you how you actually played.",
    points: [
      "Where every one of your shots landed — front, back, left, right",
      "How much of the court you covered, and how often you got back to the T",
      "How predictable you are: whether your shots repeat a pattern an opponent can read",
      "What each shot was — drive, cross-court, drop, boast, volley",
    ],
  },
  {
    icon: "videocam",
    title: "Film the match",
    lead: "This is the step that decides whether the analysis is any good.",
    points: [
      "Film from the back of the court — the gallery, balcony, or through the back wall",
      "Landscape, and propped up on something solid: a phone held in the hand drifts",
      "Frame the whole floor, especially all four floor corners",
      "Both players in shot, and at least three minutes of real rallies",
    ],
    caution:
      "Filming from the floor at the front wall, or moving the phone mid-match, breaks the court model — positions drift and the depth numbers stop meaning anything.",
  },
  {
    icon: "cloud-upload",
    title: "Import the clip",
    lead: "Library → Import & analyze, then pick the video.",
    points: [
      "The clip is shrunk on the phone first, so a long 4K match uploads in seconds",
      "Analysis then runs on the phone itself — no signal needed at the club",
      "A six-minute match takes a couple of minutes to process",
    ],
  },
  {
    icon: "scan",
    title: "Mark the court corners",
    lead: "You tap the four corners of the floor, once per match.",
    points: [
      "Tap them in the order asked: front-left, front-right, back-left, back-right",
      "Front means the front wall — the wall the ball is hit against",
      "Tap where the floor meets the wall, not the service box or the tin",
      "If a corner sits outside the frame, tap where it would be just off-screen",
    ],
    caution:
      "Everything positional is measured from these four points. A careless tap tilts the whole court, so take the extra ten seconds here.",
  },
  {
    icon: "body",
    title: "Read your analysis",
    lead: "Play the clip and watch the tracking work.",
    points: [
      "Skeletons follow both players, and each shot is named as it is struck",
      "Shot placement shows the four quadrants each player hit into",
      "The coverage heatmap shows where they spent their time on court",
      "Predictability scores how repetitive the shot patterns were — lower is harder to read",
    ],
    caution:
      "The small print at the bottom of every analysis is honest about how confident the tracking was on that clip. Read it before trusting a number.",
  },
];
