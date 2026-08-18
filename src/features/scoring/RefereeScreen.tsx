/**
 * Score keeper — the courtside scoreboard. You tap who won the rally, it keeps
 * a proper PAR-11 squash score and calls it out loud in marker's convention,
 * so two players never have to stop and argue about where they are.
 *
 * Optionally the camera watches too. When it thinks a rally has ended it ASKS
 * — out loud and on screen — and lights up the player it thinks hit last. That
 * is the whole of its authority: a human tap is still the only thing that has
 * ever changed this score, and there is no timer on this screen that can commit
 * an answer on its own.
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
import { NewMatchSheet } from "./NewMatchSheet";
import { proposalCall, proposalLevel } from "./proposal";
import { ProposalPrompt } from "./ProposalPrompt";
import { ActionRow, TopRow } from "./RefereeControls";
import { RallyButtons } from "./RallyButtons";
import { ScoreBoard } from "./ScoreBoard";
import { MatchSetup, useRefereeMatch } from "./useRefereeMatch";
import { useLiveReferee } from "./useLiveReferee";
import { WatchEntry, NoticeBanner } from "./WatchControls";
import { WatchPanel } from "./WatchPanel";
import { LetRuling, OTHER_SIDE, Side } from "./types";

export function RefereeScreen() {
  const match = useRefereeMatch();
  const live = useLiveReferee();
  const [appealOpen, setAppealOpen] = useState(false);
  // The receiver appeals far more often than the server, so that is the
  // default the sheet opens on.
  const [appealer, setAppealer] = useState<Side>(OTHER_SIDE[match.score.server]);
  const [setupOpen, setSetupOpen] = useState(false);
  const matchOver = match.score.winner !== null;

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

  // Ask each question out loud exactly ONCE. Keyed on the arrival time rather
  // than on the object, because the proposal is rebuilt whenever the player
  // binding is swapped — re-asking a question the players already heard would
  // sound like a second rally had ended.
  const askedAt = useRef(0);
  const { names, say, score } = match;
  useEffect(() => {
    if (proposal === null || proposal.at === askedAt.current) return;
    askedAt.current = proposal.at;
    const line = proposalCall(score, proposal, names, level);
    if (line !== null) say(line);
  }, [names, proposal, say, score]);

  const goBack = () => {
    selectionHaptic();
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  // Every path that settles a rally also closes the question, whether it agreed
  // with it or not. A question left standing over a scored point would invite a
  // second tap and a phantom point.
  const award = (winner: Side) => {
    live.clearProposal();
    match.awardRally(winner);
  };

  const undo = () => {
    live.clearProposal();
    match.undo();
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
      ) : (
        <>
          <ScreenHeader
            title="Score keeper"
            subtitle="You tap who won the rally — it keeps score and calls it out"
          />
          {/* Offered only when this binary can actually watch. A button that
              opens a broken camera is worse than no button. */}
          {live.available ? (
            <View style={styles.strip}>
              <WatchEntry starting={live.starting} onStart={live.start} />
            </View>
          ) : null}
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
          <Text style={styles.call} numberOfLines={2}>
            {match.lastCall ?? (showingCourt ? WATCHING_HINT : TAPPING_HINT)}
          </Text>
          {match.speechAvailable && match.muted ? <Text style={styles.callMeta}>Muted</Text> : null}
        </View>
      ) : (
        <View style={styles.promptArea}>
          <ProposalPrompt
            proposal={proposal}
            names={match.names}
            binding={live.binding}
            playResumed={live.playResumed}
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
  promptArea: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  callArea: { paddingHorizontal: spacing.md },
});
