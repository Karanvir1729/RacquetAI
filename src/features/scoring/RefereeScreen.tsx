/**
 * Score keeper — the courtside scoreboard. You tap who won the rally, it keeps
 * a proper PAR-11 squash score and calls it out loud in marker's convention,
 * so two players never have to stop and argue about where they are.
 *
 * There are two ways to put a camera on it, and they are the same engine on
 * two clocks: WATCH LIVE, where the court is in front of the phone now, and
 * SCORE A VIDEO, where an already-analysed match is refereed end to end
 * (useVideoReferee) into the same event list the buttons drive.
 *
 * Live, when it thinks a rally has ended it ASKS — out loud and on screen — and
 * lights up the player it thinks hit last. A tap is what scores the point.
 *
 * UNLESS AUTOPILOT IS ON, which is the one exception in this feature and is
 * off until a human turns it on: then a `suggest`-level rally end runs a
 * visible 4-second countdown and commits itself. Everything about that path is
 * in autopilot.ts, including why the countdown exists — at the numbers below,
 * roughly one rally in four is given to the wrong player, so the pause has to
 * be long enough for somebody standing there to beat it. `ask`-level ends never
 * autopilot: an unreadable rally stays a question no matter what the switch says.
 *
 * Why it only ever asks, in one number: hand-labelling rally ends on three
 * archive matches put "the last player to hit won the rally" at 8 of 11 —
 * 72.7%, with a 95% interval from 43.4% to 90.3%. That figure is also an
 * OVERSTATEMENT of what ships, because it assumed a perfect reading of who hit
 * last, ignored the fifth of rally ends that were unreadable, and did not
 * charge for rally-end detection misfiring on its own. Auto-confirming at that
 * rate would put the score quietly wrong within a handful of points, with no
 * way for the players to tell which point broke it. So it asks.
 *
 * Layout is fixed (no scroll). The manual controls never move and never go
 * away: the two rally buttons stay pinned to the bottom whether the camera is
 * watching or not, so refereeing entirely by hand is not a fallback mode you
 * have to find — it is just what happens if you ignore the suggestions.
 */
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { selection as selectionHaptic } from "@/lib/haptics";
import { colors, spacing, type } from "@/theme/tokens";

import { AppealSheet } from "./AppealSheet";
import { AUTOPILOT_TAG, countdownLabel } from "./autopilot";
import { NewMatchSheet } from "./NewMatchSheet";
import { proposalCall, proposalLevel } from "./proposal";
import { ProposalPrompt } from "./ProposalPrompt";
import { ActionRow, TopRow } from "./RefereeControls";
import { RallyButtons } from "./RallyButtons";
import { AutopilotToggle, ModeChooser } from "./RefereeModes";
import { ScoreBoard } from "./ScoreBoard";
import { useAutopilot } from "./useAutopilot";
import { MatchSetup, useRefereeMatch } from "./useRefereeMatch";
import { useLiveReferee } from "./useLiveReferee";
import { useVideoReferee, videoLoadCall } from "./useVideoReferee";
import { VideoPickerSheet } from "./VideoPickerSheet";
import { VideoResultBand } from "./VideoResultBand";
import { NoticeBanner } from "./WatchControls";
import { WatchPanel } from "./WatchPanel";
import { LetRuling, OTHER_SIDE, Side } from "./types";
import { toScoreEvents } from "./videoReferee";
import { listVideoSources, VideoSource } from "./videoSources";

interface RefereeScreenProps {
  /**
   * True only when the Library's card pushed this screen. On the tab there is
   * nothing behind it, so the back control is dropped rather than offering a
   * chevron that lands somewhere the user never came from.
   */
  fromLibrary?: boolean;
}

export function RefereeScreen({ fromLibrary = false }: RefereeScreenProps) {
  const match = useRefereeMatch();
  const live = useLiveReferee();
  const [appealOpen, setAppealOpen] = useState(false);
  // The receiver appeals far more often than the server, so that is the
  // default the sheet opens on.
  const [appealer, setAppealer] = useState<Side>(OTHER_SIDE[match.score.server]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sources, setSources] = useState<VideoSource[]>([]);
  // Whether the point now on the board was put there by autopilot rather than
  // by a thumb. Shown beside the call so a player scrolling back can tell
  // which points nobody confirmed.
  const [lastByAutopilot, setLastByAutopilot] = useState(false);
  const matchOver = match.score.winner !== null;

  // Refereeing a video loads its rallies into THIS match, so the result is
  // undoable, correctable on the same buttons, and persisted like any other.
  const video = useVideoReferee({
    names: match.names,
    onLoad: (setup, result) => {
      setPickerOpen(false);
      match.loadMatch(
        { names: setup.names, firstServer: setup.firstServer },
        toScoreEvents(result),
        videoLoadCall(result, setup.names),
      );
    },
  });

  // A decided match has nothing left to be asked about.
  const proposal = matchOver ? null : live.proposal;
  // One level for BOTH the screen and the spoken line — they must never
  // disagree about whether a player is being named.
  const level = proposal === null ? "ask" : proposalLevel(proposal, live.playResumed);
  const suggested = proposal !== null && level === "suggest" ? proposal.winner : null;
  const showingCourt = live.watching || live.starting;
  // Same threshold the scoreboard uses to shrink its numerals. This screen does
  // not scroll, so on a 667pt phone every band has to give something back.
  const compact = useWindowDimensions().height < 750;
  // On a short phone, a question plus the two buttons needs the lower half of
  // the screen, and the watch band is the least valuable thing on it at that
  // moment: the answer to "it named the wrong player" is to tap the other
  // player, not to go and re-bind the tracker. The band returns the instant the
  // question is answered.
  const showBand = showingCourt && !(compact && proposal !== null);

  // AUTOPILOT. Armed only when the human turned it on AND the camera is
  // actually watching — a countdown running against a stale question on a
  // stopped session would award a point for footage nobody is looking at.
  const autopilot = useAutopilot({
    proposal,
    level,
    enabled: match.autopilot && live.watching,
    onCommit: (winner) => {
      live.clearProposal();
      match.awardRally(winner);
      setLastByAutopilot(true);
    },
  });

  // Ask each question out loud exactly ONCE. Keyed on the arrival time rather
  // than on the object, because the proposal is rebuilt whenever the player
  // binding is swapped — re-asking a question the players already heard would
  // sound like a second rally had ended.
  const askedAt = useRef(0);
  const { names, say, score } = match;
  const autopilotPending = autopilot.pending !== null;
  useEffect(() => {
    if (proposal === null || proposal.at === askedAt.current) return;
    askedAt.current = proposal.at;
    // Autopilot is about to make the call itself, four seconds from now. Two
    // spoken lines that close together would collide — the announcer stops the
    // line in flight before the next one (speech.ts), so the question would be
    // cut off mid-sentence by the score it was asking about. The countdown is
    // on screen; the marker's call is what gets spoken.
    if (autopilotPending) return;
    const line = proposalCall(score, proposal, names, level);
    if (line !== null) say(line);
  }, [autopilotPending, names, proposal, say, score]);

  // Referee is its own tab AND a pushed route from the Library card. Pushed,
  // the chevron goes back where it came from; as a tab there is nothing behind
  // it, so TopRow drops the control instead of offering a dead one. Note that
  // `canGoBack()` alone is not the test — inside a tab navigator it is true as
  // soon as any tab has been visited.
  const goBack = fromLibrary && router.canGoBack()
    ? () => {
        selectionHaptic();
        router.back();
      }
    : null;

  // Every path that settles a rally also closes the question, whether it agreed
  // with it or not. A question left standing over a scored point would invite a
  // second tap and a phantom point.
  const award = (winner: Side) => {
    live.clearProposal();
    match.awardRally(winner);
    setLastByAutopilot(false);
  };

  const undo = () => {
    live.clearProposal();
    match.undo();
    setLastByAutopilot(false);
  };

  const openAppeal = () => {
    selectionHaptic();
    setAppealer(OTHER_SIDE[match.score.server]);
    setAppealOpen(true);
  };

  const rule = (ruling: LetRuling) => {
    setAppealOpen(false);
    live.clearProposal();
    match.ruleAppeal(appealer, ruling);
  };

  // Listing analyses reads the disk, so it happens on the tap that asks for the
  // list — never on a render path, where a slow or broken directory would cost
  // a frame of the scoreboard.
  const openVideoPicker = () => {
    try {
      setSources(listVideoSources());
    } catch {
      setSources([]);
    }
    setPickerOpen(true);
  };

  const openSetup = () => {
    selectionHaptic();
    // Only guard a match that is actually underway — a finished or untouched
    // one has nothing left to lose.
    if (!match.canUndo || matchOver) {
      setSetupOpen(true);
      return;
    }
    Alert.alert("Start a new match?", "The current match and its score will be discarded.", [
      { text: "Keep scoring", style: "cancel" },
      { text: "New match", style: "destructive", onPress: () => setSetupOpen(true) },
    ]);
  };

  const start = (setup: MatchSetup) => {
    setSetupOpen(false);
    live.clearProposal();
    match.startMatch(setup);
  };

  return (
    <Screen>
      <TopRow
        muted={match.muted}
        speechAvailable={match.speechAvailable}
        onToggleMute={match.toggleMute}
        onBack={goBack}
      />

      {/* ONE band at a time, and the order is what the screen is currently for:
          the court while watching, the result while a video is loaded, the two
          ways in otherwise. Stacking them cost more than the 874pt this screen
          has — it does not scroll, so a fourth block pushes the scoreboard and
          the rally buttons into each other. */}
      {showingCourt ? (
        // Hidden with `display: none` rather than unmounted, so making room for
        // a question does not tear down and re-attach the native preview layer
        // once per rally.
        <View
          style={[styles.strip, showBand ? null : styles.collapsed]}
          accessibilityElementsHidden={!showBand}
          importantForAccessibility={showBand ? "auto" : "no-hide-descendants"}
        >
          <WatchPanel
            Preview={live.Preview}
            status={live.status}
            starting={live.starting}
            names={match.names}
            binding={live.binding}
            onSwapBinding={live.swapBinding}
            rallyStrikes={live.rallyStrikes}
            compact={compact}
          />
        </View>
      ) : video.result !== null ? (
        <View style={styles.strip}>
          <VideoResultBand
            result={video.result}
            names={match.names}
            firstServer={video.firstServer}
            onSwapPlayers={video.swapPlayers}
            onSetFirstServer={video.setFirstServer}
            onClear={video.clear}
          />
        </View>
      ) : (
        <>
          <ScreenHeader
            title="Referee"
            subtitle="Watch live or score a video — it calls the score out loud"
          />
          {/* Two ways in. The live one is hidden on a binary that cannot watch
              (a button that opens a broken camera is worse than no button);
              scoring a video needs no camera and is always offered. */}
          <View style={styles.strip}>
            <ModeChooser
              liveAvailable={live.available}
              autopilot={match.autopilot}
              starting={live.starting}
              onWatchLive={live.start}
              onScoreVideo={openVideoPicker}
            />
            {/* Only where it can apply: autopilot is about the live camera
                deciding rallies, and a video is scored end to end regardless. */}
            {live.available ? (
              <AutopilotToggle autopilot={match.autopilot} onToggle={match.toggleAutopilot} />
            ) : null}
          </View>
          {video.problem === null ? null : (
            <View style={styles.strip}>
              <Text style={styles.problem}>{video.problem}</Text>
            </View>
          )}
        </>
      )}

      {live.notice === null ? null : (
        <View style={styles.strip}>
          <NoticeBanner notice={live.notice} onDismiss={live.dismissNotice} />
        </View>
      )}

      {/* Takes the slack in both modes: whatever is left over on this screen
          belongs to the numerals, not to the video. */}
      <View style={styles.board}>
        <ScoreBoard score={match.score} names={match.names} onChooseBox={match.chooseBox} />
      </View>

      {proposal === null ? (
        <View style={styles.callRow}>
          {/* Three lines where there is room for them. Everything spoken is
              also drawn here, so muting costs no information — and a video
              result is the longest line this screen ever says. A 667pt phone
              cannot spare the third line and gets the score from the board. */}
          <Text style={styles.call} numberOfLines={compact ? 2 : 3}>
            {match.lastCall ?? (showingCourt ? WATCHING_HINT : TAPPING_HINT)}
          </Text>
          {lastByAutopilot && match.lastCall !== null ? (
            <Text style={styles.callMeta}>{AUTOPILOT_TAG}</Text>
          ) : null}
          {match.speechAvailable && match.muted ? <Text style={styles.callMeta}>Muted</Text> : null}
        </View>
      ) : (
        <View style={styles.promptArea}>
          <ProposalPrompt
            proposal={proposal}
            names={match.names}
            binding={live.binding}
            playResumed={live.playResumed}
            countdown={
              autopilot.pending === null
                ? null
                : countdownLabel(match.names[autopilot.pending], autopilot.seconds)
            }
            onDismiss={live.clearProposal}
          />
        </View>
      )}

      <View style={styles.callArea}>
        {matchOver ? (
          <Button label="New match" onPress={openSetup} />
        ) : (
          <RallyButtons
            names={match.names}
            server={match.score.server}
            suggested={suggested}
            onWin={award}
          />
        )}
      </View>

      <ActionRow
        canUndo={match.canUndo}
        matchOver={matchOver}
        watching={showingCourt}
        autopilot={live.available ? match.autopilot : null}
        onToggleAutopilot={match.toggleAutopilot}
        onUndo={undo}
        onAppeal={openAppeal}
        onNewMatch={openSetup}
        onStopWatching={live.stop}
      />

      <AppealSheet
        visible={appealOpen}
        names={match.names}
        appealer={appealer}
        onChangeAppealer={setAppealer}
        onRule={rule}
        onClose={() => setAppealOpen(false)}
      />
      <VideoPickerSheet
        visible={pickerOpen}
        sources={sources}
        onPick={video.score}
        onClose={() => setPickerOpen(false)}
      />
      <NewMatchSheet
        visible={setupOpen}
        initialNames={match.names}
        onStart={start}
        onClose={() => setSetupOpen(false)}
      />
    </Screen>
  );
}

const TAPPING_HINT = "Tap a player when they win a rally.";
/** Says the quiet part: the taps are still yours, camera or no camera. */
const WATCHING_HINT = "Watching for the end of a rally. Tap a player at any time.";

const styles = StyleSheet.create({
  strip: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  collapsed: { display: "none" },
  board: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.md },
  callRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  call: { ...type.captionStrong, color: colors.textDim, flex: 1 },
  callMeta: { ...type.caption, color: colors.textFaint },
  problem: { ...type.caption, color: colors.textDim },
  promptArea: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  callArea: { paddingHorizontal: spacing.md },
});
