# features/scoring

Owned by the **feat/ai-scoring** worktree (`.worktrees/scoring`). Everything about turning match
footage into a score lives here: analysis pipeline hooks, the scoreboard UI, per-sport rule
models (tennis / pickleball / badminton), and the route body of `src/app/score.tsx`. The plan
itself is `docs/03-ai-scoring-plan.md` (same worktree). Other branches must not edit files in
this folder or that route — shared primitives graduate to `src/components/` via main.
