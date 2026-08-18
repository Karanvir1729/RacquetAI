# features/scoring

The **Score keeper** (`/referee`): a courtside squash scoreboard you tap, which keeps a proper
PAR-11 score and announces it out loud in the marker's convention — so two players mid-match
never have to stop and argue about where they are.

It is reached from the Library's "Score keeper" card (`features/recording/ScoreKeeperCard.tsx`,
which navigates by route only). The route file `src/app/referee.tsx` is a hidden tab
(`href: null` in `_layout`, like `/analysis`): the app is deliberately two tabs.

## Honesty

This is **human-tapped scoring with spoken output**. Nothing here watches the court. The shot
detector in `analysis/` audits at 63% precision and cannot tell a rally end from a bounce, so
no copy on this screen — or about it — may imply the app is scoring by itself. "Score keeper"
and "referee" are fine; "AI referee" is not.

## The state machine

Restored from `54fcba7^` and narrowed to squash (the multi-sport `Sport` union, `tennis.ts` and
the AI-confidence fields did not come back).

- `types.ts` — `Side`, the `ScoreEvent` union (`RallyEndEvent`, `LetDecisionEvent`,
  `ServeBoxEvent`), `SquashScore`, and the `ScoreEngine` interface.
- `squash.ts` — the pure PAR-11 reducer: point-a-rally to 11, win by 2, best of 5; rally winner
  serves; a retained serve alternates boxes and a handout opens a box choice; game winner serves
  first in the next game; let / stroke / no-let.
- `engine.ts` — `getScoreEngine()`, the one door for callers that only need "fold these events".

**Everything is an event, and state is a fold of the list.** That is what makes undo one tap:
drop the last event and re-fold (`useRefereeMatch.undo`). Never write an inverse mutation. It is
also why a service-box choice is an event — a direct edit would be silently reverted by an undo.

## Speaking

- `announce.ts` — pure wording, no speech engine. Server's score first ("five, three"), "all" on
  level scores, "love" for zero, "hand out" before the new server's score, "game ball" /
  "match ball" after it (named when it belongs to the receiver, unqualified when it is the
  server's), and "game to X, two games to one" at the end of a game. Numbers are spelled out so
  a voice cannot read 10-8 as a decimal.
- `speech.ts` — expo-speech behind a `require`-in-try/catch loader, the
  `features/analysis/deviceClient.ts` pattern. **Speech is never load-bearing:** a missing or
  throwing module leaves a working silent scoreboard and `available: false`, which hides the
  mute toggle. Each line calls `stop()` before `speak()`, so a burst of taps speaks the LATEST
  score instead of a backlog of stale ones.

The mute toggle is persisted, and the spoken line is also drawn on screen — muting must not cost
the user information.

## Persistence

`storage.ts`, the sync JSON sidecar pattern from `lib/onboarding.ts` and `lib/analysisQuota.ts`:

- `referee-match.json` — the match in progress: setup plus the ordered event list, written after
  every call and read synchronously in the screen's state initializer. Only the events are
  stored, never the derived score. One malformed event rejects the **whole** file: a partially
  folded match produces a plausible wrong score, and this screen reads the score out loud.
- `referee-prefs.json` — the mute flag, in its own file so it outlives any single match.

## Tests

`squash.test.ts` and `engine.test.ts` (the restored machine and its laws), `announce.test.ts`
(every spoken line), `storage.test.ts` (round trip + every way a file can be damaged),
`speech.test.ts` (a missing, malformed or throwing module never breaks scoring), and
`RefereeScreen.test.ts` (tap → event → score → announcement → disk, undo, and resuming after the
app is killed).
