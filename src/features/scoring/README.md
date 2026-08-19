# features/scoring

The **Referee** (`/referee`): a squash scoreboard that keeps a proper PAR-11 score and announces
it out loud in the marker's convention — so two players mid-match never have to stop and argue
about where they are.

It is the **Referee** tab (`src/app/referee.tsx`, second in `_layout`), and is also still reached
from the Library's "Score keeper" card (`features/recording/ScoreKeeperCard.tsx`, which navigates
by route only). Entered from the tab bar there is nothing behind the screen, so `TopRow` drops
its "‹ Library" chevron (`onBack: null`) rather than offering a control that goes nowhere.

## Two ways in, one engine

`RefereeModes.tsx` offers both on the entry screen:

| | clock | who decides the rally |
| --- | --- | --- |
| **Watch live** | the court is in front of the phone now | autopilot, unless it has been turned off |
| **Score a video** | an analysis already on the phone, PLAYING | the app calls each rally as the footage reaches it |

They share the rally rule (4.5 s of silence ends a rally), the heuristic (the last player to
strike won it) and the PAR-11 fold. What differs is whether a human is standing there to ask.

A video is refereed by `videoReferee.ts` (pure) over the `shots` of a saved `analysis.json`, and
the result is loaded into the SAME event list the buttons drive (`useRefereeMatch.loadMatch`) —
so it is persisted, undoable one rally at a time, and correctable on the same two buttons. There
is no second kind of match anywhere in this feature.

**With footage, you watch it happen.** `VideoRefereePlayer.tsx` plays the clip and calls each
rally out loud as the playhead reaches it (`videoPlayback.ts`). Without footage — the bundled
demo, and any import that never adopted a copy of its clip — the whole reconstruction is folded
at once and read out as a summary, which is what this did before it could play anything. The two
paths produce the same events; only the pacing differs.

## Honesty

Every point on this screen comes from one of three places, and the code keeps them separate:

1. **a tap** — the only one that carries a human's authority;
2. **autopilot**, which commits the app's own suggestion after a visible 4-second countdown any
   tap can beat (`autopilot.ts`, `useAutopilot.ts`);
3. **a refereed video**, which calls each rally as the footage reaches it, or folds the lot at
   once when there is no footage to play.

The measured accuracy behind 2 and 3 is the same 72.7% per rally, so neither may be described as
accurate scoring. "Score keeper", "referee" and "autopilot" are fine; "AI referee" is not, and
neither is any copy that presents a machine-derived scoreline as a result rather than a draft.

**Autopilot ships ON**, which moves where the honesty has to live. It used to be carried by the
act of turning it on; now it is carried by four things that must all stay true:

- the caption a new user reads first (`AUTOPILOT_PITCH`) carries the error rate, not just the
  capability;
- the first watched session on a fresh install shows an alert naming the error rate and offering
  "I'll tap each point", before the camera starts (`RefereeScreen.startWatching`);
- every armed session says out loud that it is scoring by itself (`AUTOPILOT_ARMED_CALL`) —
  two players at the back of the court cannot see the screen;
- a phone that already had this app keeps autopilot OFF (`readRefereePrefs`'s `LEGACY_PREFS`).
  Inheriting a default is not consent, and one mute toggle would otherwise freeze that inherited
  `true` into their prefs file forever.

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

## Autopilot (`autopilot.ts`, `useAutopilot.ts`)

The one path in this feature where a machine changes the score. It is fenced by three rules, all
measured rather than stylistic, and `RefereeScreen.autopilot.test.ts` pins every one:

1. **Disclosed before it acts.** It is ON for a new install, so the fence is the disclosure
   above rather than an opt-in tap. The switch is on the entry screen (`AutopilotToggle`) and —
   because that screen is gone once the camera takes it over — also in the courtside action row
   while watching. A machine scoring points that nobody present can stop is the one state this
   must never reach.
2. **Only `suggest`-level ends.** An `ask` — unreadable last striker (21% of real ends), weak
   confidence, or play that carried on — is never committed, whatever the switch says. Autopilot
   stops waiting for a tap; it never guesses harder than the evidence.
3. **A visible countdown any tap beats.** `AUTOPILOT_DELAY_MS` is 4 s: the proposal already
   arrives ~6 s late, so longer lands the score after the next serve, and shorter is less time
   than it takes to walk back from the service box. Confirming, correcting and "No point" all
   cancel it, and each scores exactly once.

With autopilot on the question is **not** spoken — the countdown is on screen and the marker's
call follows 4 s later, and speech.ts stops the line in flight before starting the next, so
asking would only get cut off by its own answer. Points it scored are tagged `AUTOPILOT_TAG` on
the call line, so a player scrolling back can tell which ones nobody confirmed.

## Refereeing a video (`videoReferee.ts`, `videoSources.ts`, `useVideoReferee.ts`)

`refereeVideo(shots)` splits the stream on `RALLY_GAP_SEC` (4.5 s, the native engine's number),
drops any group under `MIN_RALLY_SHOTS` (a lone onset is a door, a bounce or a ball being picked
up), awards each rally to the last striker, and folds. It **stops at match point** and counts what
came after (`ignoredAfterMatch`) rather than scoring the knock-up for the next pair.

**The errors compound, and the copy says so.** Per rally the ceiling is 0.727; a scoreline is a
fold of those calls, so an 11-rally game is entirely right with probability ~2%. `scorelineNote`
and `videoResultCall` both call the result a draft to correct, and `VideoResultBand` shows what
was thrown away. `videoResultCall` reads the standing **leader first**, deliberately not
`announce.ts`'s server-first marker order: read out once at the end, "Sam ahead, one, two" is
what the marker's order produces when Sam leads 2-1, and it sounds like the opposite of what it
means.

Two corrections re-run the whole fold rather than editing it, because both are ways a scoreline
is wrong that the numbers cannot show: **swap players** (the analyser's "A" is whoever was
leftmost, so a wrong binding mirrors everything) and **who served first** (nothing in a video
reveals it, and it shifts every hand-out).

## Watching a video referee itself (`videoPlayback.ts`, `VideoRefereePlayer.tsx`)

**The score is a function of the playhead**, never a cursor that only goes forward:
`scoreAfter(rallies, calledBy(rallies, t), firstServer)`. Scrub back and the score rewinds;
scrub forward and it catches up in one step; the same second always reads the same. A
forward-only cursor survives ordinary playback and is then permanently wrong the first time
anybody drags the scrubber back — with nothing on screen to show it.

- **A call lands `CALL_DELAY_SEC` (1.2 s) after the rally's last strike**, not on it: the point
  is still visibly ending. Well inside the 4.5 s rally gap, so a call can never slide into the
  next rally.
- **One rally crossed → the marker's call, from `buildAnnouncement`** — the same wording a
  tapped rally produces. More than one crossed in a single tick means a seek, and the honest
  thing to say then is nothing: the call for the last of them describes a score nobody heard
  build. Backwards is silent for the same reason.
- **`playToEnd` takes the whole prefix** and speaks the one-pass summary. The last rally's call
  can land past the end of the file, and the same analysis must not score lower played than
  folded.
- **A human correction detaches it.** Any manual tap, undo or let ruling while a video is
  attached stops playback writing to the score at all, pauses the footage, and offers to hand it
  back from wherever the playhead now is. Without that, the next rally crossing silently
  reinstates the rally they just corrected.

**The audio is not optional.** On iOS the video's own audio and the spoken call go into the same
session and sum at full volume — and a squash video's audio is ball strikes in the same range as
a voice, so an un-ducked call is not quiet, it is unintelligible. The announcer therefore reports
when it starts and stops speaking (`Announcer.watch`, `SpeechWatcher`) and the player drops to
15% for the length of the line. That contract is **balanced by construction** — an 8-second guard
timer, plus `stop()`, plus the throw path — because a video left permanently silent is a worse
bug than the one being fixed. `audioMixingMode: "mixWithOthers"` is separate and also required:
expo-video's iOS default takes the session exclusively and would stop the user's music.

`videoSources.ts` lists ANALYSES, not recordings — a take that was never analysed has no shot
stream to referee — plus the bundled demo, pinned last and always present, which is what makes
this half demonstrable on a Simulator with no camera and an empty library.

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

- **Nothing commits on a timer unless a human armed one.** With autopilot off — the default —
  there is no timeout anywhere on this screen and an unanswered question stays unanswered
  (pinned by a test that advances a minute of fake time). Autopilot is the deliberate exception
  and is described in its own section below; what is NOT allowed, then or now, is a timer the
  user did not ask for, because at 72.7% oracle accuracy it would put the score quietly wrong
  within a handful of points with no way for the players to tell which point broke it.
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

`videoReferee.test.ts` (the rally split at its boundaries, the fold, the stop at match point, the
binding, and the wording), `videoPlayback.test.ts` (the score as a function of the playhead, and
what is said when it moves), `RefereeScreen.autopilot.test.ts`, `RefereeScreen.video.test.ts` and
`RefereeScreen.playback.test.ts` (all three driven through the real screen), plus the originals:
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
