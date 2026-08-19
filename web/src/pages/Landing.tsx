import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Crosshair,
  Flame,
  LayoutGrid,
  Minus,
  MousePointerClick,
  Plus,
  PlayCircle,
  Repeat2,
  ScanLine,
  Upload,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { HeroPlate } from "@/components/HeroPlate";
import { WaitlistBand } from "@/components/WaitlistBand";
import { ButtonLink } from "@/components/ui/Button";
import { Card, IconChip } from "@/components/ui/Card";
import { AccentBadge, Chip } from "@/components/ui/Chip";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHead } from "@/components/ui/Section";
import { Stat } from "@/components/ui/Stat";
import { HERO_MATCH } from "@/data/heroMatch";

/**
 * The RacquetIQ landing page.
 *
 * Structure follows Daybot's section rhythm — alternating --rq-bg / --rq-panel
 * bands separated by a hairline, generous padding, one uniform card recipe —
 * with RacquetIQ's palette and one hard rule of its own: nothing on this page
 * claims a capability the pipeline does not have. The "Limits" band is not an
 * apology, it is the product's argument.
 */

const STEPS = [
  {
    icon: <Upload className="h-5 w-5" />,
    title: "Upload the match",
    body: "Drag in a squash match filmed from behind the court — a phone wedged on the balcony rail is enough. One file, one upload, no account required.",
  },
  {
    icon: <MousePointerClick className="h-5 w-5" />,
    title: "Mark the four corners",
    body: "You get back a frame from your own video. Click the four floor corners in the order asked. That is what turns pixels into court positions.",
  },
  {
    icon: <ScanLine className="h-5 w-5" />,
    title: "The footage gets read",
    body: "Both players are detected and pose-tracked through the match, shots are picked out of movement and sound, and each one is placed in a court quadrant.",
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: "Read the match back",
    body: "Your video with the skeletons drawn over it, plus the shot mix, placement, coverage, T-time and predictability — per player, with the caveats attached.",
  },
];

const READOUT = [
  {
    icon: <Activity className="h-5 w-5" />,
    title: "Pose overlay on your video",
    body: "Seventeen tracked joints per player, drawn on the match as it plays and letterbox-corrected so the skeletons sit on the players, not beside them.",
  },
  {
    icon: <PlayCircle className="h-5 w-5" />,
    title: "The current shot, live with playback",
    body: "Scrub anywhere and the read-out follows: whose shot it is, where it landed, and what the classifier thinks it was.",
  },
  {
    icon: <LayoutGrid className="h-5 w-5" />,
    title: "Placement, four quadrants",
    body: "Front-left, front-right, back-left, back-right. Coarse on purpose — it is the split that survives a 480p club recording.",
  },
  {
    icon: <Flame className="h-5 w-5" />,
    title: "Coverage heatmap",
    body: "Where each player actually spent the match, on a plan of the court, straight from the tracked positions.",
  },
  {
    icon: <Crosshair className="h-5 w-5" />,
    title: "T-time",
    body: "The share of sampled frames spent within a metre and a half of the T — the single number most club players want and never have.",
  },
  {
    icon: <Repeat2 className="h-5 w-5" />,
    title: "Predictability",
    body: "How repetitive the shot selection was, as entropy over the placement grid, with the most frequent pattern named.",
  },
];

const LIMITS = [
  {
    title: "No live tracking",
    body: "RacquetIQ reads a file after the match. There is no real-time mode, no camera feed, nothing to wear, and no line-calling.",
  },
  {
    title: "Shot detection is approximate",
    body: "The detector was audited at roughly 63% precision — about two in three detected shots are real. Treat the counts as indicative, not as a score sheet.",
  },
  {
    title: "Shot types are a best guess",
    body: "At 854×480 with no ball tracking, a drop and a soft drive can look identical. Types carry a confidence, “unknown” is a real answer, and there is deliberately no “lob”.",
  },
  {
    title: "Squash, and no coaching",
    body: "The court model is a squash court — no tennis, no padel, no badminton. RacquetIQ reports what it measured and stops there; what to do about it is between you and your coach.",
  },
];

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What footage actually works?",
    a: "A fixed camera behind the back wall — the balcony view — with the whole floor in frame and both players visible. Handheld panning, a side-on phone at floor level, or a court where the front corners are cropped out will all degrade the result. 720p or better helps; the sample below is only 854×480 and still readable.",
  },
  {
    q: "Why do I have to mark the corners myself?",
    a: "The four floor corners are what map your camera's view onto a real court, so a position in pixels becomes a position in metres. It takes four clicks and it is the difference between a heatmap and a smear. Corners are allowed to fall outside the frame — if the front-left corner is off the edge of your video, click where it would be.",
  },
  {
    q: "How long does the analysis take?",
    a: "It depends on the length of the match and the machine doing the work, and the page shows real progress the whole way. The sample match is 7 minutes 31 seconds and 3,383 frames were sampled from it.",
  },
  {
    q: "Does this work on a phone?",
    a: "Yes — upload, corner marking and the full read-out are built for touch. The corner picker is the fiddly one, so it takes one corner at a time and lets you confirm each before moving on.",
  },
  {
    q: "What happens to my video?",
    a: "The browser uploads it to the analysis server this site is pointed at, the server processes it and hands back an analysis file. No account is required to analyse, there is no public gallery, and nothing is posted anywhere.",
  },
  {
    q: "Is this the same thing as the iOS app?",
    a: "Same pipeline, same analysis file format. RacquetIQ started on iOS; this is that analysis in a browser, on whatever machine you already have the footage on.",
  },
];

function HeroHeadline({ lit }: { lit: boolean }) {
  const reduced = useReducedMotion();

  return (
    <h1 className="rq-hero mx-auto max-w-[16ch] text-balance">
      Your squash match,{" "}
      <span className="relative inline-block">
        {/* Base copy: always legible, whether or not the sweep ever runs. */}
        <span style={{ color: "var(--rq-accent-text)" }}>measured.</span>
        {!reduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(105deg, var(--rq-accent-text) 0%, var(--rq-accent-text) 40%, var(--rq-sweep) 50%, var(--rq-accent-text) 60%, var(--rq-accent-text) 100%)",
              backgroundSize: "260% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
            }}
            initial={{ opacity: 0, backgroundPosition: "185% 50%" }}
            animate={
              lit
                ? {
                    opacity: 1,
                    backgroundPosition: "-10% 50%",
                    filter: "drop-shadow(0 0 26px var(--rq-glow))",
                  }
                : { opacity: 0, backgroundPosition: "185% 50%" }
            }
            transition={{
              backgroundPosition: { duration: 1.5, ease: "easeOut" },
              filter: { duration: 1.1, ease: "easeOut" },
              opacity: { duration: 0.5 },
            }}
          >
            measured.
          </motion.span>
        )}
      </span>
    </h1>
  );
}

function FaqRow({ item, index }: { item: { q: string; a: ReactNode }; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const answerId = `rq-faq-answer-${index}`;
  return (
    <Reveal delay={index * 0.04}>
      <Card
        className="overflow-hidden"
        style={{ borderColor: open ? "var(--rq-accent-line)" : "var(--rq-line)" }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={answerId}
          className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-200 hover:bg-rq-raised"
        >
          <span className="rq-label text-[15px]">{item.q}</span>
          <span style={{ color: "var(--rq-accent-text)" }}>
            {open ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </span>
        </button>
        {open ? (
          <p id={answerId} className="rq-body-sm px-5 pb-5" style={{ color: "var(--rq-text-dim)" }}>
            {item.a}
          </p>
        ) : null}
      </Card>
    </Reveal>
  );
}

export default function Landing() {
  const [lit, setLit] = useState(false);
  const ignite = useCallback(() => setLit(true), []);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* One soft Optic bloom behind the plate. The page's only gradient. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(58% 46% at 50% 8%, var(--rq-glow-soft), transparent 62%)",
          }}
        />
        <div className="relative mx-auto max-w-shell px-5 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8 lg:pb-24">
          <div className="flex flex-col items-center text-center">
            <AccentBadge>
              <Activity className="h-4 w-4" />
              Squash video analysis, in the browser
            </AccentBadge>

            <div className="mt-6">
              <HeroHeadline lit={lit} />
            </div>

            <p className="rq-lead mt-6 max-w-2xl">
              Upload a match filmed from the balcony, mark the four floor corners, and RacquetIQ
              reads it back to you — where each player stood, where the ball landed, and how
              predictable the pattern was.
            </p>

            <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
              <ButtonLink to="/analyze" size="lg">
                Analyze a match <ArrowRight className="h-5 w-5" />
              </ButtonLink>
              <ButtonLink to="/demo" size="lg" variant="outline">
                <PlayCircle className="h-5 w-5" /> See a real analysis
              </ButtonLink>
            </div>

            <a
              href="#waitlist"
              className="rq-caption mt-4 inline-flex min-h-[44px] items-center transition-colors duration-200 hover:text-rq-text focus-visible:text-rq-text"
            >
              No analysis server to point it at? Join the early-access waitlist ↓
            </a>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {["Squash only", "Your own footage", "No live tracking", "Works on a phone"].map(
                (label) => (
                  <Chip key={label}>{label}</Chip>
                ),
              )}
            </div>
          </div>

          <div className="mx-auto mt-14 max-w-4xl sm:mt-16">
            <HeroPlate onFilled={ignite} />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section id="how" tone="panel">
        <Reveal>
          <SectionHead
            eyebrow="How it works"
            title="Four steps, and one of them is yours."
            body="No calibration rig, no markers on the floor, no wearables. A video file and four clicks."
          />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.08} className="h-full">
              <Card className="flex h-full flex-col p-6">
                <IconChip>{step.icon}</IconChip>
                <p className="rq-micro-label mt-5">Step {index + 1}</p>
                <h3 className="rq-h4 mt-1.5">{step.title}</h3>
                <p className="rq-body-sm mt-2.5" style={{ color: "var(--rq-text-dim)" }}>
                  {step.body}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── What you get ─────────────────────────────────────────────────── */}
      <Section id="readout">
        <Reveal>
          <SectionHead
            eyebrow="The read-out"
            title="Six things you cannot get by watching the footage again."
            body="Everything below is measured from your video. Nothing is a rating, a grade, or a prediction about your next match."
          />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {READOUT.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.06} className="h-full">
              <Card className="flex h-full flex-col p-6">
                <IconChip>{item.icon}</IconChip>
                <h3 className="rq-h4 mt-4">{item.title}</h3>
                <p className="rq-body-sm mt-2.5" style={{ color: "var(--rq-text-dim)" }}>
                  {item.body}
                </p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Proof ────────────────────────────────────────────────────────── */}
      <Section tone="panel">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <Reveal>
            <SectionHead
              eyebrow="A real analysis"
              title="Here is exactly what came out of one club-grade recording."
              body="A 7½-minute match from archive.org, 854×480, filmed from the balcony — about as unglamorous as footage gets. These are the pipeline's own numbers, not a mock-up."
            />
            <div className="mt-8">
              <ButtonLink to="/demo" size="lg">
                Open the sample analysis <ArrowRight className="h-5 w-5" />
              </ButtonLink>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <Card className="p-6 sm:p-7">
              {/* Every stat reserves two label lines: at 375px "Both players
                  seen" wraps and its neighbours do not, which would drop one
                  number off the row's shared baseline — on the one card whose
                  argument is that these numbers line up as evidence. */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3">
                <Stat
                  label="Footage"
                  value={HERO_MATCH.durationLabel}
                  hint="minutes analysed"
                  reserveTwoLines
                />
                <Stat
                  label="Shots detected"
                  value={HERO_MATCH.shots}
                  hint="across both players"
                  reserveTwoLines
                />
                <Stat
                  label="Rallies"
                  value={HERO_MATCH.rallies}
                  hint="longest 59 shots"
                  reserveTwoLines
                />
                <Stat
                  label="Frames sampled"
                  value={HERO_MATCH.framesAnalyzed.toLocaleString("en")}
                  hint="pose-tracked"
                  reserveTwoLines
                />
                <Stat
                  label="Both players seen"
                  value={HERO_MATCH.bothPlayersDetectedPct}
                  unit="%"
                  hint="of sampled frames"
                  reserveTwoLines
                />
                <Stat
                  label="Resolution"
                  value="854"
                  unit="×480"
                  hint="the hard case"
                  reserveTwoLines
                />
              </div>
              <p className="rq-caption mt-7">
                Every analysis ships with this footnote attached — frames measured, how often both
                players were visible, and whether there was an audio track to lean on. A number
                without its footnote is a guess with confidence.
              </p>
            </Card>
          </Reveal>
        </div>
      </Section>

      {/* ── Limits ───────────────────────────────────────────────────────── */}
      <Section id="limits">
        <Reveal>
          <SectionHead
            eyebrow="Limits"
            title="What RacquetIQ will not tell you."
            body="Vision on club footage is genuinely hard, and a confidently wrong number is worse than no number. So here is the honest edge of the thing."
          />
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {LIMITS.map((limit, index) => (
            <Reveal key={limit.title} delay={index * 0.07} className="h-full">
              <Card className="flex h-full gap-4 p-6">
                <span
                  className="mt-1 h-8 w-1 shrink-0 rounded-rq-pill"
                  style={{ background: "var(--rq-line-2)" }}
                />
                <div>
                  <h3 className="rq-h4">{limit.title}</h3>
                  <p className="rq-body-sm mt-2" style={{ color: "var(--rq-text-dim)" }}>
                    {limit.body}
                  </p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section id="faq" tone="panel" width="prose">
        <Reveal>
          <SectionHead eyebrow="FAQ" title="Questions, answered." align="center" />
        </Reveal>
        <div className="mt-10 space-y-3">
          {FAQ.map((item, index) => (
            <FaqRow key={item.q} item={item} index={index} />
          ))}
        </div>
      </Section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <Section compact>
        <div className="relative overflow-hidden text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: "radial-gradient(50% 60% at 50% 30%, var(--rq-glow-soft), transparent 62%)",
            }}
          />
          <div className="relative flex flex-col items-center">
            <h2 className="rq-h2 max-w-2xl">Point it at your own match.</h2>
            <p className="rq-lead mt-4 max-w-xl">
              One video, four clicks, and the part of your game you have never actually seen.
            </p>
            <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <ButtonLink to="/analyze" size="lg">
                Analyze a match <ArrowRight className="h-5 w-5" />
              </ButtonLink>
              <ButtonLink to="/demo" size="lg" variant="outline">
                See a real analysis
              </ButtonLink>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Waitlist ─────────────────────────────────────────────────────── */}
      <WaitlistBand />
    </>
  );
}
