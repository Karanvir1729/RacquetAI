/**
 * The Referee, on the web.
 *
 * Same job as the phone's Referee tab and, more importantly, the same CODE:
 * the score, the rules and every spoken word come from
 * `@app/features/scoring/*` via useWebReferee. Nothing about PAR-11 is
 * reimplemented here — this file is only the surface.
 *
 * Laid out for a laptop propped beside a court: the numerals are the biggest
 * thing on the page, the two rally buttons are wide targets, and the keyboard
 * works because on a laptop that is faster than the mouse.
 */
import { useCallback, useEffect, useState } from "react";

import { Section, SectionHead } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { cn } from "@/lib/cn";
import { useWebReferee } from "@/referee/useWebReferee";
import { DEFAULT_PLAYER_NAMES } from "@app/features/scoring/announce";
import { OTHER_SIDE, type LetRuling, type Side } from "@app/features/scoring/types";

const RULINGS: { key: LetRuling; label: string; caption: (n: string, o: string) => string }[] = [
  { key: "let", label: "Let", caption: () => "Rally replayed — no point, same server" },
  { key: "stroke", label: "Stroke", caption: (n) => `Point to ${n}` },
  { key: "no-let", label: "No let", caption: (_n, o) => `Point to ${o}` },
];

export default function Referee() {
  useDocumentTitle("Referee");
  const ref = useWebReferee();
  const [appealOpen, setAppealOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [nameA, setNameA] = useState(DEFAULT_PLAYER_NAMES.A);
  const [nameB, setNameB] = useState(DEFAULT_PLAYER_NAMES.B);
  const [firstServer, setFirstServer] = useState<Side>("A");

  const { awardRally, undo, matchOver } = ref;

  // A laptop referee has a keyboard, and reaching for it beats the trackpad
  // between rallies. Left/right award, U undoes, L opens an appeal. Ignored
  // while typing into the setup fields.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (matchOver) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); awardRally("A"); }
      else if (event.key === "ArrowRight") { event.preventDefault(); awardRally("B"); }
      else if (event.key.toLowerCase() === "u") { event.preventDefault(); undo(); }
      else if (event.key.toLowerCase() === "l") { event.preventDefault(); setAppealOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awardRally, undo, matchOver]);

  const startMatch = useCallback(() => {
    ref.startMatch(
      { A: nameA.trim() || DEFAULT_PLAYER_NAMES.A, B: nameB.trim() || DEFAULT_PLAYER_NAMES.B },
      firstServer,
    );
    setSetupOpen(false);
  }, [ref, nameA, nameB, firstServer]);

  const { score, names } = ref;
  const appealer = OTHER_SIDE[score.server];

  return (
    <Section>
      <SectionHead
        eyebrow="Referee"
        title="Call the score"
        body="A PAR-11 squash scoreboard that says the score out loud. Tap who won each rally — or use the arrow keys."
      />

      {/* Scoreboard. The numerals are the point of the page. */}
      <Card className="mt-6 p-6 sm:p-8">
        <div className="grid grid-cols-2 gap-4">
          {(["A", "B"] as const).map((side) => (
            <div
              key={side}
              className={cn(
                "rounded-xl border p-4 text-center transition-colors",
                score.server === side
                  ? "border-[var(--rq-accent-text)] bg-[var(--rq-card-raised)]"
                  : "border-[var(--rq-line)] bg-[var(--rq-card)]",
              )}
            >
              <div className="truncate text-[13px] font-medium text-[var(--rq-text-dim)]">
                {names[side]}
              </div>
              <div className="mt-1 text-6xl font-bold tabular-nums text-[var(--rq-text)] sm:text-7xl">
                {score.points[side]}
              </div>
              <div className="mt-1 text-[12px] text-[var(--rq-text-dim)]">
                {score.games[side]} {score.games[side] === 1 ? "game" : "games"}
                {score.server === side ? (
                  <span className="ml-2 text-[var(--rq-accent-text)]">
                    serving · {score.serveBox}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* Whatever was said is also written: muting must cost no information. */}
        <p className="mt-5 min-h-[2.5rem] text-center text-[15px] text-[var(--rq-text)]">
          {ref.lastCall ?? "Tap a player when they win a rally."}
        </p>

        {score.winner !== null ? (
          <p className="mt-1 text-center text-[13px] font-semibold text-[var(--rq-accent-text)]">
            Match to {names[score.winner]}
          </p>
        ) : null}

        {/* The two rally buttons, pinned wide. */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          {(["A", "B"] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => ref.awardRally(side)}
              disabled={matchOver}
              className={cn(
                "min-h-[64px] rounded-xl border border-[var(--rq-line-2)] bg-[var(--rq-card-raised)]",
                "px-4 text-[15px] font-semibold text-[var(--rq-text)]",
                "transition-colors hover:bg-[var(--rq-chip)] focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-[var(--rq-accent-text)] disabled:opacity-40",
              )}
            >
              {names[side]} won the rally
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={ref.undo} disabled={!ref.canUndo}>
            Undo
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAppealOpen(true)} disabled={matchOver}>
            Let…
          </Button>
          {score.serverMayChooseBox ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => ref.chooseBox(score.serveBox === "right" ? "left" : "right")}
            >
              Serving from {score.serveBox} — switch
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => ref.setMuted(!ref.muted)}>
            {ref.muted ? "Unmute" : "Mute"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSetupOpen(true)}>
            New match
          </Button>
        </div>

        {!ref.speechSupported ? (
          <p className="mt-3 text-center text-[12px] text-[var(--rq-text-faint)]">
            This browser cannot speak the score. Every call is still written above.
          </p>
        ) : null}

        <p className="mt-3 text-center text-[12px] text-[var(--rq-text-faint)]">
          Keys: ← {names.A} · → {names.B} · U undo · L let
        </p>
      </Card>

      {/* Games already finished, so the board is not the only record. */}
      {score.gameHistory.length > 0 ? (
        <p className="mt-3 text-center text-[13px] text-[var(--rq-text-dim)]">
          Games:{" "}
          {score.gameHistory.map((game, i) => (
            <span key={i} className="tabular-nums">
              {i > 0 ? ", " : ""}
              {game.A}-{game.B}
            </span>
          ))}
        </p>
      ) : null}

      {appealOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--rq-scrim)] p-4 sm:items-center">
          <Card className="w-full max-w-md p-5">
            <h2 className="text-[17px] font-semibold text-[var(--rq-text)]">
              {names[appealer]} appeals
            </h2>
            <div className="mt-4 grid gap-2">
              {RULINGS.map((ruling) => (
                <button
                  key={ruling.key}
                  type="button"
                  onClick={() => {
                    ref.ruleAppeal(appealer, ruling.key);
                    setAppealOpen(false);
                  }}
                  className="rounded-lg border border-[var(--rq-line-2)] bg-[var(--rq-card-raised)] px-4 py-3 text-left transition-colors hover:bg-[var(--rq-chip)]"
                >
                  <span className="block text-[15px] font-semibold text-[var(--rq-text)]">
                    {ruling.label}
                  </span>
                  <span className="block text-[13px] text-[var(--rq-text-dim)]">
                    {ruling.caption(names[appealer], names[OTHER_SIDE[appealer]])}
                  </span>
                </button>
              ))}
            </div>
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setAppealOpen(false)}>
              Cancel
            </Button>
          </Card>
        </div>
      ) : null}

      {setupOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--rq-scrim)] p-4 sm:items-center">
          <Card className="w-full max-w-md p-5">
            <h2 className="text-[17px] font-semibold text-[var(--rq-text)]">New match</h2>
            {ref.canUndo && !matchOver ? (
              <p className="mt-1 text-[13px] text-[var(--rq-text-dim)]">
                The current match and its score will be discarded.
              </p>
            ) : null}
            <label className="mt-4 block text-[13px] text-[var(--rq-text-dim)]">
              Player A
              <input
                value={nameA}
                onChange={(e) => setNameA(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--rq-line-2)] bg-[var(--rq-input)] px-3 py-2 text-[15px] text-[var(--rq-text)]"
              />
            </label>
            <label className="mt-3 block text-[13px] text-[var(--rq-text-dim)]">
              Player B
              <input
                value={nameB}
                onChange={(e) => setNameB(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--rq-line-2)] bg-[var(--rq-input)] px-3 py-2 text-[15px] text-[var(--rq-text)]"
              />
            </label>
            <fieldset className="mt-3">
              <legend className="text-[13px] text-[var(--rq-text-dim)]">Serves first</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(["A", "B"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setFirstServer(side)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[14px] transition-colors",
                      firstServer === side
                        ? "border-[var(--rq-accent-text)] text-[var(--rq-text)]"
                        : "border-[var(--rq-line-2)] text-[var(--rq-text-dim)]",
                    )}
                  >
                    {side === "A" ? nameA || "Player A" : nameB || "Player B"}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setSetupOpen(false)}>
                Cancel
              </Button>
              <Button onClick={startMatch}>Start match</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </Section>
  );
}
