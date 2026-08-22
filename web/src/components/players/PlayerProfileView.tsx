import { ArrowUpRight, Check, Copy, Link2, MessageCircle, Pencil, Share2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { formatClock, formatPercent, prettyPattern } from "@/analysis/format";
import type { ShotTypeCount } from "@/analysis/shots";
import { SHOT_TYPES } from "@/analysis/types";
import { PlacementGrid } from "@/components/analysis/PlacementGrid";
import { ShotTypeBars } from "@/components/analysis/ShotTypeBars";
import { CourtPlan } from "@/components/CourtPlan";
import { ContributionGrid, formatIsoDay } from "@/components/players/ContributionGrid";
import { DayRecordings } from "@/components/players/DayRecordings";
import { MovementChart } from "@/components/players/MovementChart";
import { ScoutingNotes } from "@/components/players/ScoutingNotes";
import { TrendSparkline } from "@/components/players/TrendSparkline";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { Meter, Stat } from "@/components/ui/Stat";
import { buildProfileStats, clipsOnDay, scoutingNotes, sortChronologically } from "@/players/aggregate";
import { shareUrl } from "@/players/store";
import {
  HANDS,
  PLAYER_NOTES_MAX,
  isIsoDay,
  validateNotes,
  validatePlayerName,
  type Hand,
  type Player,
  type PlayerClip,
  type ShotTypeCounts,
} from "@/players/shape";

/**
 * One player, every clip they were named on, rendered whole.
 *
 * Order is deliberate, as it is on the read-out. First the calendar, because
 * "how much footage is this built on" is the question that qualifies every
 * number below it; then the four headline figures; then the tendencies (the
 * same court plan, placement grid and shot mix a single read-out draws, over
 * the pooled numbers); then the scouting notes, which are the point; then the
 * trend and the recordings themselves, so every claim can be traced to the
 * clips it came from. Between the tendencies and the notes sits the movement
 * chart — the tendencies recording by recording — because "has this moved"
 * is the question a coach asks right after "where do they live".
 *
 * A calendar cell opens that day's recordings under the grid ("by clicking
 * on the github box I should be able to tell what video it was"); "Show in
 * list" from there scrolls to the clip's row and lights it for a moment, so
 * the eye lands where the edits are.
 *
 * The maths is all in players/aggregate.ts — this file lays it out and, when
 * not read-only, offers the edits (rename, hand, notes, delete; re-date or
 * untag a clip) through callbacks that return an error message or null, the
 * store's own convention. The sample profile, a signed-out visitor and anyone
 * opening a share link get the same view with the controls left off.
 *
 * Sharing sits in the header too, owner-only: a profile is private until its
 * owner mints a link, and the panel that shows while one is live says in so
 * many words what the link gives away (the name, the notes, the pooled
 * numbers — never the footage, which never left the browser that ran it).
 */

export interface PlayerProfileViewProps {
  player: Player;
  clips: readonly PlayerClip[];
  readOnly?: boolean;
  onRename?: (name: string) => Promise<string | null>;
  onHand?: (hand: Hand | null) => Promise<string | null>;
  onNotes?: (notes: string) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onUntagClip?: (clipId: string) => Promise<string | null>;
  onClipDate?: (clipId: string, playedAt: string) => Promise<string | null>;
  /** History ids present in THIS browser — the only ones "Open in library" can honour. */
  libraryIds?: ReadonlySet<string>;
  /** A note over the profile — the sample's "not a real person". */
  banner?: ReactNode;
  /**
   * The share link, for the owner. `token` is what the row carries (null =
   * private); the callbacks mint and revoke, returning an error message or
   * null, and the page re-reads the player so `token` follows.
   */
  share?: {
    token: string | null;
    onEnable: () => Promise<string | null>;
    onDisable: () => Promise<string | null>;
  };
}

/** How long "Copied" stands on the copy button before it reads "Copy link" again. */
const COPIED_MS = 2000;

/** How long a recording row stays outlined after "Show in list" points at it. */
const FLASH_MS = 1600;

const HAND_LABELS: Record<Hand, string> = { right: "Right-handed", left: "Left-handed" };

/**
 * The pooled shot classes in the shape ShotTypeBars draws — most frequent
 * first, "unknown" last, contract order breaking ties — the same ranking
 * `countShotTypes` in analysis/shots.ts applies to a single match, so the
 * profile's mix and a read-out's mix line up bar for bar.
 */
function shotTypeCounts(counts: ShotTypeCounts): ShotTypeCount[] {
  return SHOT_TYPES.filter((type) => counts[type] > 0)
    .map((type): ShotTypeCount => ({ type, count: counts[type] }))
    .sort((a, b) => {
      const aUnknown = a.type === "unknown";
      const bUnknown = b.type === "unknown";
      if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
      if (a.count !== b.count) return b.count - a.count;
      return SHOT_TYPES.indexOf(a.type) - SHOT_TYPES.indexOf(b.type);
    });
}

/**
 * A date worth saving. `<input type="date">` fires change on every complete
 * value as the year is typed — "0002-08-21", "0020-08-21" — and each would
 * otherwise round-trip to the server. Nothing was filmed before the pipeline
 * existed, so anything earlier than this century is a keystroke, not a date.
 */
function isPlausibleDay(value: string): boolean {
  return isIsoDay(value) && value >= "2000-01-01";
}

/** "+4 pts vs opponents" — a real minus sign, and no colour: a delta is a fact, not a verdict. */
function formatDelta(delta: number): string {
  const rounded = Math.round(Math.abs(delta));
  if (rounded === 0) return "Level with opponents";
  return `${delta < 0 ? "−" : "+"}${rounded} pts vs opponents`;
}

const INPUT_STYLE = {
  borderColor: "var(--rq-line-2)",
  background: "var(--rq-input)",
  color: "var(--rq-text)",
} as const;

/** The racquet-hand picker, shared with the roster's add form. */
export function HandSelect({
  id,
  value,
  onChange,
  label = "Racquet hand",
}: {
  id: string;
  value: Hand | null;
  onChange: (hand: Hand | null) => void;
  label?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
        {label}
      </span>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as Hand))}
        className="min-h-[44px] w-full rounded-rq-sm border px-3 text-[15px]"
        style={INPUT_STYLE}
      >
        <option value="">Not known</option>
        {HANDS.map((hand) => (
          <option key={hand} value={hand}>
            {HAND_LABELS[hand]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlayerProfileView({
  player,
  clips,
  readOnly = false,
  onRename,
  onHand,
  onNotes,
  onDelete,
  onUntagClip,
  onClipDate,
  libraryIds,
  banner,
  share,
}: PlayerProfileViewProps) {
  const stats = useMemo(() => buildProfileStats(clips), [clips]);
  const notes = useMemo(() => scoutingNotes(stats), [stats]);
  const mix = useMemo(() => shotTypeCounts(stats.shotTypes), [stats.shotTypes]);
  // Newest first for reading; the aggregate sorts oldest first for the maths.
  const recent = useMemo(() => sortChronologically(clips).reverse(), [clips]);

  // --- the open calendar day -----------------------------------------------
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const dayClips = useMemo(
    () => (selectedDay === null ? [] : clipsOnDay(clips, selectedDay)),
    [clips, selectedDay],
  );
  // The clips changed under the panel (a re-date, an untag): what it showed
  // may no longer be true, so it closes rather than show a stale day.
  // Close the open day only when the SET of recordings changes (a tag added or
  // removed, a clip re-dated) — not on every re-read of the same clips after a
  // rename or a share toggle, which would snap the panel shut under the reader.
  const clipsKey = useMemo(() => clips.map((clip) => `${clip.id}@${clip.playedAt}`).join("\n"), [clips]);
  useEffect(() => {
    setSelectedDay(null);
  }, [clipsKey]);

  const [flashClipId, setFlashClipId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // Scroll the recordings list to the clip's row, focus it, and outline it
  // for a moment. Focus without scrolling, or it would cut the smooth scroll
  // short; and no smooth scroll for anyone who asked for less motion.
  const showInList = (clipId: string) => {
    const row = document.getElementById(`clip-${clipId}`);
    if (row === null) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    row.focus({ preventScroll: true });
    setFlashClipId(clipId);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashClipId(null), FLASH_MS);
  };

  // --- header edits ------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: player.name, hand: player.hand, notes: player.notes });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A save that lands reloads the player; the draft follows so a second edit
  // starts from what is now true rather than from the last thing typed.
  useEffect(() => {
    setDraft({ name: player.name, hand: player.hand, notes: player.notes });
  }, [player.name, player.hand, player.notes]);

  const nameError = editing ? validatePlayerName(draft.name) ?? undefined : undefined;
  const notesError = editing ? validateNotes(draft.notes) ?? undefined : undefined;

  const save = async () => {
    if (nameError !== undefined || notesError !== undefined) return;
    setBusy(true);
    setFailure(null);
    // Three separate writes because the store exposes three; they stop at the
    // first failure so a rejected name never leaves a half-applied edit.
    let message: string | null = null;
    const name = draft.name.trim();
    const notesText = draft.notes.trim();
    if (name !== player.name && onRename !== undefined) message = await onRename(name);
    if (message === null && draft.hand !== player.hand && onHand !== undefined) message = await onHand(draft.hand);
    if (message === null && notesText !== player.notes && onNotes !== undefined) {
      message = await onNotes(notesText);
    }
    setBusy(false);
    if (message === null) setEditing(false);
    else setFailure(message);
  };

  const remove = async () => {
    if (onDelete === undefined) return;
    setBusy(true);
    setFailure(null);
    const message = await onDelete();
    setBusy(false);
    if (message !== null) {
      setFailure(message);
      setConfirmDelete(false);
    }
  };

  // --- clip edits --------------------------------------------------------
  const [confirmUntag, setConfirmUntag] = useState<string | null>(null);
  const [clipBusy, setClipBusy] = useState<string | null>(null);
  const [clipFailure, setClipFailure] = useState<string | null>(null);

  const redate = async (clipId: string, playedAt: string) => {
    if (onClipDate === undefined || !isPlausibleDay(playedAt)) return;
    setClipBusy(clipId);
    setClipFailure(null);
    const message = await onClipDate(clipId, playedAt);
    setClipBusy(null);
    if (message !== null) setClipFailure(message);
  };

  const untag = async (clipId: string) => {
    if (onUntagClip === undefined) return;
    setClipBusy(clipId);
    setClipFailure(null);
    const message = await onUntagClip(clipId);
    setClipBusy(null);
    setConfirmUntag(null);
    if (message !== null) setClipFailure(message);
  };

  // --- sharing -----------------------------------------------------------
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFailure, setShareFailure] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);

  // The "Copied" state is on a timer; a page that unmounts first must not
  // set state on a component that is gone.
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const startSharing = async () => {
    if (share === undefined) return;
    setShareBusy(true);
    setShareFailure(null);
    const message = await share.onEnable();
    setShareBusy(false);
    if (message !== null) setShareFailure(message);
  };

  const stopSharing = async () => {
    if (share === undefined) return;
    setShareBusy(true);
    setShareFailure(null);
    const message = await share.onDisable();
    setShareBusy(false);
    setConfirmStop(false);
    if (message !== null) setShareFailure(message);
  };

  const copyLink = async (url: string) => {
    try {
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // No clipboard API (plain http, an old WebView, permission refused):
      // leave the link selected so a long-press or ⌘C finishes the job.
      linkInput.current?.focus();
      linkInput.current?.select();
    }
  };

  const minutes = Math.round(stats.totalSec / 60);
  const canEdit = !readOnly && (onRename !== undefined || onHand !== undefined || onNotes !== undefined);
  const canDelete = !readOnly && onDelete !== undefined;
  const canShare = !readOnly && share !== undefined;
  // Pre-match scouting as a conversation: the coach reads this profile by id,
  // which only resolves on the owner's roster — so owner-only, like sharing.
  const canAskCoach = !readOnly;
  const shareLink = canShare && share !== undefined && share.token !== null ? shareUrl(share.token) : null;

  return (
    <>
      <Section divider={false}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="rq-eyebrow">Player profile</p>
            <h1 className="rq-h2 mt-3 break-words">{player.name}</h1>
            <div className="mt-5 flex flex-wrap gap-2">
              {player.hand !== null ? <Chip>{HAND_LABELS[player.hand]}</Chip> : null}
              <Chip>
                {stats.recordings} {stats.recordings === 1 ? "recording" : "recordings"}
              </Chip>
              {stats.recordings > 0 ? <Chip>{minutes} min analysed</Chip> : null}
              {stats.firstPlayedAt !== null ? <Chip>since {formatIsoDay(stats.firstPlayedAt)}</Chip> : null}
            </div>
            {player.notes.length > 0 && !editing ? (
              <p className="rq-lead-sm mt-4 max-w-2xl whitespace-pre-line">{player.notes}</p>
            ) : null}
          </div>
          {canEdit || canDelete || canShare || canAskCoach ? (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing((value) => !value);
                    setFailure(null);
                  }}
                  aria-expanded={editing}
                >
                  {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  {editing ? "Cancel" : "Edit"}
                </Button>
              ) : null}
              {canShare && shareLink === null ? (
                <Button variant="outline" size="sm" onClick={() => void startSharing()} disabled={shareBusy}>
                  <Share2 className="h-4 w-4" /> {shareBusy ? "Creating link…" : "Share a link"}
                </Button>
              ) : null}
              {canAskCoach ? (
                <ButtonLink to={`/coach?scout=${encodeURIComponent(player.id)}`} variant="outline" size="sm">
                  <MessageCircle className="h-4 w-4" /> Ask the coach how to play them
                </ButtonLink>
              ) : null}
              {canDelete && !confirmDelete ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" /> Delete player
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {shareLink !== null ? (
          <Card className="mt-6 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0" style={{ color: "var(--rq-accent-text)" }} aria-hidden="true">
                <Link2 className="h-4 w-4" />
              </span>
              {/* Read-only and select-all on focus: on a phone, tapping the
                  field is how you get the whole link without dragging handles. */}
              <input
                ref={linkInput}
                type="text"
                readOnly
                value={shareLink}
                aria-label={`Share link for ${player.name}`}
                onFocus={(e) => e.currentTarget.select()}
                className="rq-num min-h-[44px] min-w-0 flex-1 basis-48 rounded-rq-sm border px-3 text-[14px]"
                style={INPUT_STYLE}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyLink(shareLink)}
                aria-live="polite"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              {confirmStop ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void stopSharing()}
                    disabled={shareBusy}
                    style={{ color: "var(--rq-danger)", borderColor: "var(--rq-danger)" }}
                  >
                    {shareBusy ? "Stopping…" : "Stop sharing"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)} disabled={shareBusy}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmStop(true)} disabled={shareBusy}>
                  Stop sharing
                </Button>
              )}
            </div>
            <p className="rq-caption mt-3">
              Anyone with the link can read this profile — name, notes, the pooled numbers and the
              list of recordings (titles and dates). Not the
              footage.{confirmStop ? " Stopping makes the link go dead at once; sharing again mints a new one." : ""}
            </p>
            {shareFailure !== null ? (
              <p className="rq-caption mt-2" role="alert" style={{ color: "var(--rq-danger)" }}>
                {shareFailure}
              </p>
            ) : null}
          </Card>
        ) : shareFailure !== null ? (
          <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
            {shareFailure}
          </p>
        ) : null}

        {banner !== undefined ? <div className="mt-6">{banner}</div> : null}

        {confirmDelete ? (
          <Card className="mt-6 p-5 sm:p-6">
            <p className="rq-label" style={{ color: "var(--rq-text)" }}>
              Delete {player.name}?
            </p>
            <p className="rq-caption mt-1.5">
              Their {stats.recordings} tagged {stats.recordings === 1 ? "recording" : "recordings"} come
              off this roster with them. The analyses themselves stay in your library — only the name
              on them goes. This cannot be undone.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {/* The status palette as ink on the outline variant — a danger
                  FILL would need its own on-colour token, and this site has
                  exactly one filled button colour. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void remove()}
                disabled={busy}
                style={{ color: "var(--rq-danger)", borderColor: "var(--rq-danger)" }}
              >
                <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Keep
              </Button>
            </div>
          </Card>
        ) : null}

        {editing ? (
          <Card className="mt-6 p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="player-name"
                label="Name"
                value={draft.name}
                maxLength={80}
                error={nameError}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <HandSelect
                id="player-hand"
                value={draft.hand}
                onChange={(hand) => setDraft((d) => ({ ...d, hand }))}
              />
            </div>
            <label htmlFor="player-notes" className="mt-5 flex flex-col gap-1.5">
              <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
                Notes
              </span>
              <textarea
                id="player-notes"
                rows={3}
                maxLength={PLAYER_NOTES_MAX}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                className="w-full rounded-rq-sm border px-3 py-2.5 text-[15px]"
                style={{
                  ...INPUT_STYLE,
                  borderColor: notesError === undefined ? "var(--rq-line-2)" : "var(--rq-danger)",
                }}
              />
              <span
                className="rq-caption"
                style={{ color: notesError === undefined ? "var(--rq-text-dim)" : "var(--rq-danger)" }}
              >
                {notesError ??
                  "Anything the numbers cannot tell you — how they serve, what they do under pressure."}
              </span>
            </label>
            {failure !== null ? (
              <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
                {failure}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={busy || nameError !== undefined || notesError !== undefined}
              >
                <Check className="h-4 w-4" /> {busy ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : failure !== null ? (
          <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
            {failure}
          </p>
        ) : null}

        {clips.length === 0 ? (
          <Card className="mt-8 p-6 sm:p-8">
            <h2 className="rq-h3">No recordings yet</h2>
            {readOnly ? (
              // A shared (or sample) profile with nothing tagged: the reader
              // cannot add to it, so no "name this player" instructions.
              <p className="rq-lead-sm mt-3">
                Nothing has been tagged to this profile yet, so there are no numbers to show.
              </p>
            ) : (
              <>
                <p className="rq-lead-sm mt-3">
                  Name this player on any read-out — the Analyze page or Your matches — and it lands
                  here. Every clip they are named on adds to the same profile.
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <ButtonLink to="/library" variant="outline" size="md">
                    Your matches
                  </ButtonLink>
                  <ButtonLink to="/analyze" size="md">
                    Analyze a match
                  </ButtonLink>
                </div>
              </>
            )}
          </Card>
        ) : (
          <>
            <Card className="mt-8 p-5 sm:p-7">
              <ContributionGrid
                clips={clips}
                heading="Recordings calendar"
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
              />
              {selectedDay !== null ? (
                <div className="mt-5">
                  <Hairline />
                  <div className="mt-5">
                    <DayRecordings
                      date={selectedDay}
                      clips={dayClips}
                      libraryIds={libraryIds}
                      onClose={() => setSelectedDay(null)}
                      onShowInList={showInList}
                    />
                  </div>
                </div>
              ) : null}
            </Card>

            {/* The four headline figures ride in the same band as the
                calendar: they describe the footage you just saw the extent of. */}
            <Card className="mt-6 p-5 sm:p-7">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <div>
                  <Stat
                    label="T-time"
                    value={stats.tTimePct === null ? "—" : stats.tTimePct.toFixed(1)}
                    unit={stats.tTimePct === null ? undefined : "%"}
                    hint={
                      stats.versus.clips > 0 && stats.versus.tTimeDelta !== null
                        ? formatDelta(stats.versus.tTimeDelta)
                        : "Frames within 1.5 m of the T"
                    }
                  />
                  {stats.tTimePct !== null ? (
                    <Meter value={stats.tTimePct / 100} label={`${player.name} T-time`} />
                  ) : null}
                </div>
                <div>
                  <Stat
                    label="Predictability"
                    value={stats.predictability === null ? "—" : formatPercent(stats.predictability)}
                    hint="Higher means easier to read"
                  />
                  {stats.predictability !== null ? (
                    <Meter value={stats.predictability} label={`${player.name} predictability`} />
                  ) : null}
                </div>
                {/* These two share a row at 375px; the second label can wrap,
                    so both hold two lines and the values keep one baseline. */}
                <Stat
                  label="Avg rally"
                  value={stats.avgRallyShots === null ? "—" : stats.avgRallyShots.toFixed(1)}
                  unit={stats.avgRallyShots === null ? undefined : "shots"}
                  hint={stats.longestRally > 0 ? `Longest ${stats.longestRally}` : "In their recordings"}
                  reserveTwoLines
                />
                <Stat
                  label="Shots per clip"
                  value={stats.recordings > 0 ? Math.round(stats.totalShots / stats.recordings) : "—"}
                  hint={`${stats.totalShots} in all`}
                  reserveTwoLines
                />
              </div>
            </Card>
          </>
        )}
      </Section>

      {clips.length > 0 ? (
        <>
          <Section tone="panel">
            <p className="rq-eyebrow">Tendencies</p>
            <h2 className="rq-h3 mt-3">Where they play, and where they send it</h2>
            <p className="rq-lead-sm mt-3 max-w-2xl">
              Pooled over every recording: the court plan and T-time are weighted by how long each
              one ran; placement, shot mix and patterns are totals. Placement is where each shot was
              retrieved — the opponent's position at the next ball, a proxy for where it landed. The
              pipeline does not track the ball.
            </p>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Reveal>
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <p className="rq-micro-label">Where they spent their time</p>
                  {stats.coverage === null ? (
                    <p className="rq-caption mt-3">
                      No court map — these clips carry the numbers but no coverage heatmap.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-1 items-center justify-center">
                      <div style={{ height: "clamp(220px, 40vw, 300px)", aspectRatio: "64 / 97.5" }}>
                        <CourtPlan
                          rows={stats.coverage.rows}
                          cols={stats.coverage.cols}
                          values={stats.coverage.values}
                          ariaLabel={`Court plan of where ${player.name} spent their time, pooled over ${stats.recordings} ${
                            stats.recordings === 1 ? "recording" : "recordings"
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </Card>
              </Reveal>

              <Reveal delay={0.08}>
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <p className="rq-micro-label">Where the shots landed</p>
                  <p className="rq-caption mt-1.5">
                    {stats.placementTotal} shots by the quadrant they were retrieved from — a proxy for
                    where they landed.
                  </p>
                  <div className="mt-4">
                    <PlacementGrid placement={stats.placement} />
                  </div>
                </Card>
              </Reveal>

              <Reveal delay={0.16}>
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <p className="rq-micro-label">Shot mix (indicative)</p>
                  <p className="rq-caption mt-1.5">
                    {stats.classifiedShots} shots carrying a class. Classes are read from body pose with
                    no ball tracking and are unaudited; shot detection itself was audited at ~63%
                    precision, so every count here includes some phantom shots.
                  </p>
                  <div className="mt-4">
                    <ShotTypeBars counts={mix} />
                  </div>
                </Card>
              </Reveal>

              <Reveal delay={0.24}>
                <Card className="flex h-full flex-col p-5 sm:p-6">
                  <p className="rq-micro-label">Top patterns</p>
                  <p className="rq-caption mt-1.5">
                    Where one shot landed, then where the next did — share of all{" "}
                    {stats.transitionsTotal} such pairs.
                  </p>
                  {stats.topPatterns.length === 0 ? (
                    <p className="rq-caption mt-4">No shot-to-shot sequences yet.</p>
                  ) : (
                    <ol className="mt-4 flex flex-col gap-3">
                      {stats.topPatterns.map((item, index) => (
                        <li key={item.pattern} className="flex items-baseline gap-3">
                          <span
                            className="rq-num text-[13px] font-extrabold"
                            style={{ color: "var(--rq-text-dim)", minWidth: "1.25em" }}
                          >
                            {index + 1}
                          </span>
                          <span className="text-[15px] font-semibold" style={{ color: "var(--rq-text)" }}>
                            {prettyPattern(`${item.pattern} (${Math.round(item.share * 100)}%)`)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </Reveal>
            </div>

            <Reveal className="mt-6">
              <MovementChart clips={clips} />
            </Reveal>

            <div className="mt-14">
              <p className="rq-eyebrow">What to exploit</p>
              <h2 className="rq-h3 mt-3">Scouting notes</h2>
              <p className="rq-lead-sm mt-3 max-w-2xl">
                Rule-based, over the numbers above. Each note says what it rests on: where the players
                were, for how long, and where the ball was retrieved are measured; a shot class is a
                reading of body pose, and is marked as such.
              </p>
              <div className="mt-8">
                <ScoutingNotes notes={notes} totalShots={stats.totalShots} recordings={stats.recordings} />
              </div>
            </div>
          </Section>

          <Section>
            {stats.trend.length >= 3 ? (
              <Reveal>
                <Card className="p-5 sm:p-7">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 className="rq-h3">Trend</h2>
                    <p className="rq-caption">Oldest recording on the left, one point per clip.</p>
                  </div>
                  <div className="mt-6 grid gap-8 sm:grid-cols-2">
                    <TrendSparkline points={stats.trend} metric="tTimePct" label="T-time" />
                    <TrendSparkline points={stats.trend} metric="predictability" label="Predictability" />
                  </div>
                </Card>
              </Reveal>
            ) : null}

            <div className={stats.trend.length >= 3 ? "mt-12" : undefined}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="rq-h3">Recordings</h2>
                <p className="rq-caption rq-num">
                  {stats.recordings} {stats.recordings === 1 ? "clip" : "clips"} · {minutes} min
                </p>
              </div>

              {clipFailure !== null ? (
                <p className="rq-lead-sm mt-4" role="alert" style={{ color: "var(--rq-danger)" }}>
                  {clipFailure}
                </p>
              ) : null}

              <ul className="mt-6 flex flex-col gap-3">
                {recent.map((clip) => {
                  const { me, opponent } = clip.summary;
                  const inLibrary =
                    clip.historyId !== null && libraryIds !== undefined && libraryIds.has(clip.historyId);
                  const confirming = confirmUntag === clip.id;
                  const working = clipBusy === clip.id;
                  return (
                    // id + tabIndex -1: "Show in list" on the calendar panel
                    // scrolls here and hands the row focus.
                    <li key={clip.id} id={`clip-${clip.id}`} tabIndex={-1}>
                      <Card
                        className="p-4 sm:p-5"
                        style={
                          flashClipId === clip.id
                            ? { outline: "2px solid var(--rq-accent-text)", outlineOffset: 2 }
                            : undefined
                        }
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-[12rem] flex-1">
                            <p className="truncate text-[15px] font-semibold text-rq-text">
                              {clip.title.length > 0 ? clip.title : "Untitled recording"}
                            </p>
                            <p className="rq-caption rq-num mt-1">
                              {formatIsoDay(clip.playedAt)} · as {me.label} ·{" "}
                              {formatClock(clip.durationSec)} · {clip.shots}{" "}
                              {clip.shots === 1 ? "shot" : "shots"}
                            </p>
                            <p className="rq-caption rq-num mt-0.5">
                              T-time {me.tTimePct.toFixed(0)}% · predictability{" "}
                              {formatPercent(me.predictability.score)}
                              {opponent !== null ? ` · opponent T-time ${opponent.tTimePct.toFixed(0)}%` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {inLibrary && clip.historyId !== null ? (
                              <ButtonLink to={`/library?match=${clip.historyId}`} variant="outline" size="sm">
                                Open in library <ArrowUpRight className="h-4 w-4" />
                              </ButtonLink>
                            ) : null}
                            {!readOnly && onClipDate !== undefined ? (
                              // Uncontrolled, keyed on the stored date: a save
                              // that lands remounts it on the new value, and a
                              // half-typed date never round-trips to the server.
                              <input
                                key={`${clip.id}-${clip.playedAt}`}
                                type="date"
                                aria-label={`Played on, for ${clip.title.length > 0 ? clip.title : "this recording"}`}
                                defaultValue={clip.playedAt}
                                disabled={working}
                                onChange={(e) => {
                                  const next = e.target.value;
                                  if (next !== clip.playedAt && isPlausibleDay(next)) void redate(clip.id, next);
                                }}
                                className="rq-num min-h-[44px] rounded-rq-sm border px-3 text-[14px]"
                                style={INPUT_STYLE}
                              />
                            ) : null}
                            {!readOnly && onUntagClip !== undefined && !confirming ? (
                              <button
                                type="button"
                                onClick={() => setConfirmUntag(clip.id)}
                                disabled={working}
                                aria-label={`Remove ${clip.title.length > 0 ? clip.title : "this recording"} from ${player.name}`}
                                className="flex h-11 w-11 items-center justify-center rounded-rq-sm border transition-colors"
                                style={{ borderColor: "var(--rq-line)", color: "var(--rq-text-dim)" }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {confirming ? (
                          <div className="mt-4">
                            <Hairline />
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                              <p className="rq-caption">
                                Remove this recording from {player.name}? The analysis stays in your
                                library; only the name comes off.
                              </p>
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => void untag(clip.id)} disabled={working}>
                                  <Trash2 className="h-4 w-4" /> {working ? "Removing…" : "Remove"}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setConfirmUntag(null)} disabled={working}>
                                  Keep
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </div>

            <p className="rq-caption mt-8 max-w-3xl">
              Coverage and T-time come from player position; placement is where each shot was
              retrieved, a proxy for where it landed. Shot detection was audited at ~63% precision;
              shot classes are unaudited and indicative. No ball tracking.
              {stats.qualityPct !== null
                ? ` Both players were detected in ${Math.round(stats.qualityPct)}% of analysed frames, time-weighted across these recordings.`
                : ""}
            </p>

            <div className="mt-8">
              <ButtonLink to="/#limits" variant="ghost" size="sm">
                What this can and cannot measure <ArrowUpRight className="h-4 w-4" />
              </ButtonLink>
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}
