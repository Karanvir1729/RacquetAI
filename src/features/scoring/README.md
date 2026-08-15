# features/scoring

Owned by the **feat/ai-scoring** worktree (`.worktrees/scoring`). Everything about turning match
footage into a score lives here. The build contract for the AI phase is
`docs/03-ai-scoring-plan.md` (same worktree); other branches must not edit files in this folder
or the `src/app/score.tsx` route — shared primitives graduate to `src/components/` via main.

Squash is the primary sport (fixed-camera club courts, box leagues, let/stroke video review);
tennis is second. Pickleball and badminton are typed but unimplemented.

What exists today (pre-AI):

- `types.ts` — the domain model the pipeline will fill: `Sport`, `Match`, the `ScoreEvent`
  union (`RallyEndEvent` + first-class `LetDecisionEvent` for let/stroke/no-let rulings),
  per-sport `MatchScore` shapes, and the shared `ScoreEngine` interface every sport sits behind.
- `squash.ts` — pure PAR-11 state machine: point-a-rally to 11, win by 2, best of 5; serve
  hand + box tracking (retained serve alternates boxes, handout opens a box choice); let/
  stroke/no-let folding. Real, tested groundwork the AI pipeline will drive; **not** the AI.
- `tennis.ts` — pure tennis state machine (love/15/30/40/deuce/advantage, games, sets,
  tiebreak, best-of-N).
- `engine.ts` — the registry (`getScoreEngine`); callers never import a sport module directly.
- `__tests__/` — unit coverage for both machines plus the shared engine laws
  (reduce = fold of apply, no mutation, no-ops after match end).
- `ScoreComingSoon.tsx` — the honest "in development" Score tab body: walkthrough of how
  scoring will work plus a visibly disabled CTA. No fake functionality.

Deliberately absent until the plan's milestones land: any model inference, any upload path,
pickleball/badminton engines (shapes typed in `types.ts`, unimplemented).
