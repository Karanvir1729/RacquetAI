import { ComingSoon } from "@/components/ComingSoon";

/**
 * Score AI tab — placeholder. AI score tracking (pick a recording, run
 * on-device/server analysis, show the point-by-point scoreboard) is owned by
 * src/features/scoring/ and lands from the feat/ai-scoring worktree.
 * The plan itself is docs/03-ai-scoring-plan.md (same worktree).
 */
export default function ScoreScreen() {
  return (
    <ComingSoon
      title="Score AI"
      phase="feat/ai-scoring"
      icon="tennisball-outline"
      description="Automatic score tracking from your match videos lands here. Record a match first — scoring runs on footage from your Library."
    />
  );
}
