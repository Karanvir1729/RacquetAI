import { ScoreComingSoon } from "@/features/scoring/ScoreComingSoon";

/**
 * Score AI tab — thin route. The pre-AI "in development" experience, the
 * scoring domain model, and the tennis state machine all live in
 * src/features/scoring/ (feat/ai-scoring worktree). The build contract for the
 * AI phase is docs/03-ai-scoring-plan.md.
 */
export default function ScoreScreen() {
  return <ScoreComingSoon />;
}
