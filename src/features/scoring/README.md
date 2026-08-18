# features/scoring

The **Score keeper** (`/referee`): a courtside squash scoreboard you tap, which keeps a proper
PAR-11 score and announces it out loud in the marker's convention — so two players mid-match
never have to stop and argue about where they are.

It is reached from the Library's "Score keeper" card (`features/recording/ScoreKeeperCard.tsx`,
which navigates by route only). The route file `src/app/referee.tsx` is a hidden tab
(`href: null` in `_layout`, like `/analysis`): the app is deliberately two tabs.

## Honesty

This is **human-tapped scoring with spoken output**. The camera may now watch the court and
*suggest* the winner of a rally (`liveClient.ts`), but nothing scores by itself: every point
still lands because a person tapped. No copy on this screen — or about it — may imply
otherwise. "Score keeper" and "referee" are fine; "AI referee" is not.

## Watching the court (`liveClient.ts`)

The JS half of the native live session in `modules/racquet-analyzer/ios/`
(`LiveSession.swift` → `LiveReferee.swift` → `LiveOnset.swift`). It emits **proposals**, never
score events — `liveClient.ts` deliberately exposes no function that awards a point.

**The measured reason.** There is no ball tracking anywhere in this project, and a squash rally
ends for reasons that are entirely about the ball: two bounces, the tin, out, or a retrieval
that failed. Hand-labelling rally outcomes on three archive matches put the heuristic behind
the proposal — *the last player to strike the ball won the rally* — at **8/11 = 72.7%**
(Wilson 95% CI 43.4%–90.3%, n = 11). All three misses were the last striker **losing**: a
scrambling retrieval that failed, which is exactly what a camera without a ball cannot see.

That 72.7% is an **oracle**: it was scored against the true last striker read off the frames by
hand, not against anything the detector produces. The detector is worse, and the same labelling
session showed why — 1 of 15 inspected breaks in the shot stream was not a rally end at all
(the players were mid-rally through a 5.2 s gap of missed shots), and the detector's "last shot"
is frequently a floor bounce or a ball pickup seconds after the point was already over.

So `LiveConfidence.heuristicPrior` (0.727) is a **ceiling**, and each measured failure mode
multiplies it downwards. `parseRallyEnded` re-clamps `confidence` into `[0, ceiling]` on the JS
side too — that invariant is the one thing this feature must not get wrong, so it is enforced
in both halves.

`recommendation` is what the UI should do, and the number decides it, not taste:

| band | meaning |
| --- | --- |
| `confirm` (≥ 0.85) | unreachable today **by construction** — the prior caps at 0.727. It exists so a better measurement can change the UX without changing UI code. |
| `propose` (≥ 0.45) | show a suggested winner, obviously correctable. |
| `ask` | show both players equally. No default under the thumb. |

**At today's numbers most rallies land in `ask` or `propose`, never `confirm`.** The screen must
therefore keep the manual taps live at all times and stay fully usable with the camera off.

## The screen, when it is watching

`useLiveReferee.ts` owns the session; `proposal.ts` owns every word it says; `WatchPanel.tsx`
(preview stamp + status + the track-binding swap), `WatchControls.tsx` (the offer and the
fallback banner) and `ProposalPrompt.tsx` (the question) are the UI; `RefereeControls.tsx` holds
the two chrome rows so `RefereeScreen.tsx` stays about composition. `useLiveReferee` has **no
reference to `useRefereeMatch`** — it cannot reach the score even by accident.

**Answering happens on the rally buttons that were already there.** There is no separate confirm
control. A `propose`-band rally end lights up the suggested player's own button
(`RallyButtons`'s `suggested` prop, accent fill + "suggested · tap to confirm"), so confirming is
one tap, correcting is one tap on the other button, and refereeing entirely by hand is never a
mode anyone has to leave — ignoring the suggestions *is* the manual referee.

Consequences of the measurement, in the UI:

- **Nothing commits on a timer.** There is no timeout anywhere on this screen. An unanswered
  question stays unanswered (pinned by a test that advances a minute of fake time). At 72.7%
  oracle accuracy an auto-confirm would put the score quietly wrong within a handful of points,
  with no way for the players to tell which point broke it.
- **Everything spoken is a question.** `proposalCall` produces "Point to Sam? That would be five,
  three." and never the marker's declarative forms that `announce.ts` reserves for a decision a
  human made — pinned across every score state by `proposal.test.ts`. The question goes through
  the *same* announcer as the calls, so the two can never overlap, and it obeys the same mute.
- **`ask` names nobody.** Below the propose band, when the last striker was unreadable (21% of
  real ends), or when shots keep landing after the question (`playResumed` — the mid-rally
  misfire), the headline becomes "Who won that rally?" and no button is lit.
- **"No point"** dismisses without scoring, for the break that was never a rally end.
- **"Why?"** expands the engine's own sentence with the tracker's "Player A" mapped onto the
  bound names in one pass, plus the confidence *and* the ceiling it can never exceed.

Everything else is about not being a liability courtside: the offer to watch is hidden entirely
when the module or the preview view is missing (a button that opens a broken camera is worse than
no button); a refused session falls back to the tap-driven screen with a sentence and, for a
denied permission, a Settings link; the camera is released on stop, on unmount and on background,
and resumed on foreground; keep-awake is held only while watching. The preview is a small stamp,
not a hero: it answers "is the phone pointed at the court?", which is asked once, while the score
is read every rally for forty-five minutes.

Other things the screen has to honour:

- **`proposedWinner` is a tracker identity, not a player.** "A" is whoever was leftmost the
  first time two people were seen on court. `TrackBinding` binds it to a `Side`, and `flipBinding`
  must be one tap away, because trackers swap.
- **No microphone, no detection.** Shot detection is an audio onset detector with a pose gate;
  there is no measured video-only fallback, so a denied microphone yields `detectionAvailable:
  false` and a pose-only preview rather than guesses.
- **No corners, no court filter.** Without four tapped corners the filter that rejects the next
  court and the gallery cannot run (`courtCalibrated: false`).
- **The proposal arrives late.** ~6 s after the last detected strike (a 4.5 s silence threshold
  plus a 1.6 s gate delay), and the true rally end is often seconds before that again.
- The rally rule is **tunable per venue** and that is measured, not suspected: an 8 s split gave
  47 shots per "rally" on the same footage where 4.5 s matched the play.

`modules/racquet-analyzer/checks/run.sh` exercises the native rally engine off-device.

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
`speech.test.ts` (a missing, malformed or throwing module never breaks scoring),
`RefereeScreen.test.ts` (tap → event → score → announcement → disk, undo, and resuming after the
app is killed), and `liveClient.test.ts` (every live entry point degrades instead of throwing —
including when merely *reading* a module property explodes, which is how the shipped crash
presented — plus the confidence ceiling and the track binding).

For the watching screen: `proposal.test.ts` (every spoken line is a question, in every score
state; the suggestion is dropped rather than softened when the evidence is weak or play resumed;
the tracker's labels map onto the right humans even with the default names and a swapped binding)
and `RefereeScreen.watch.test.ts`, which drives the real screen through a faked native session —
**a rally-end event never changes the score**, a minute of fake time changes nothing, confirming
and correcting are each one tap, dismissing scores nothing, the manual buttons keep working
throughout, and a binary that cannot watch simply shows the tap-driven referee.
