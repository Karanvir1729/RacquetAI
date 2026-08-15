# features/scoring

Owned by the **feat/ai-scoring** worktree (`.worktrees/scoring`). Everything about turning match
footage into a score lives here. The build contract for the AI phase is
`docs/03-ai-scoring-plan.md` (same worktree); other branches must not edit files in this folder
or the `src/app/score.tsx` route — shared primitives graduate to `src/components/` via main.

What exists today (pre-AI):

- `types.ts` — the domain model the pipeline will fill: `Sport`, `Match`, `ScoreEvent`
  (point winner + video timestamp + confidence + source), and per-sport `MatchScore` shapes.
- `tennis.ts` — pure tennis score state machine (love/15/30/40/deuce/advantage, games, sets,
  tiebreak, best-of-N). Real, tested groundwork the AI pipeline will drive; **not** the AI.
- `__tests__/tennis.test.ts` — unit coverage for the state machine.
- `ScoreComingSoon.tsx` — the honest "in development" Score tab body: walkthrough of how
  scoring will work plus a visibly disabled CTA. No fake functionality.

Deliberately absent until the plan's milestones land: any model inference, any upload path,
pickleball/badminton reducers (typed in `types.ts`, unimplemented).
