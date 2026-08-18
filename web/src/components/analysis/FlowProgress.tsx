import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

/**
 * The two things every waiting screen needs: where you are in the flow, and
 * whether the thing you are waiting on is actually moving.
 *
 * `progress` of null renders an indeterminate sweep rather than a bar parked
 * at 0 — the server genuinely returns `progressPct: null` for phases it cannot
 * estimate, and a frozen bar reads as a hang. The sweep respects
 * `prefers-reduced-motion` through the media query in the stylesheet.
 */

export const FLOW_STEPS = ["Upload", "Mark the court", "Analysis", "Read-out"] as const;

export function StepRail({ active }: { active: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {FLOW_STEPS.map((step, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li key={step} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
                style={{
                  background: done || current ? "var(--rq-accent)" : "var(--rq-card-raised)",
                  color: done || current ? "var(--rq-on-accent)" : "var(--rq-text-faint)",
                  border: "1px solid var(--rq-line)",
                }}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className="text-[12.5px] font-bold"
                style={{
                  color: current
                    ? "var(--rq-text)"
                    : done
                      ? "var(--rq-accent-text)"
                      : "var(--rq-text-faint)",
                }}
              >
                {step}
              </span>
            </span>
            {index < FLOW_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className="hidden h-px w-6 sm:block"
                style={{ background: "var(--rq-line-2)" }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressPanel({
  eyebrow,
  title,
  detail,
  progress,
  children,
}: {
  eyebrow: string;
  title: string;
  detail?: ReactNode;
  /** 0..1, or null when the phase cannot be estimated. */
  progress: number | null;
  children?: ReactNode;
}) {
  const pct = progress === null ? null : Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <Card className="p-6 sm:p-8">
      <p className="rq-eyebrow">{eyebrow}</p>
      <h2 className="rq-h3 mt-2">{title}</h2>

      <div
        className="mt-6 h-2 w-full overflow-hidden rounded-rq-pill"
        style={{ background: "var(--rq-line)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct === null ? {} : { "aria-valuenow": pct })}
        aria-label={title}
      >
        <div
          className={cn("h-full rounded-rq-pill", pct === null && "rq-indeterminate")}
          style={{
            width: pct === null ? "40%" : `${pct}%`,
            background: "var(--rq-data)",
            transition: "width 500ms var(--rq-ease)",
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px]" style={{ color: "var(--rq-text-dim)" }}>
          {detail}
        </p>
        {pct === null ? null : (
          <p className="rq-num text-[13px] font-bold" style={{ color: "var(--rq-accent-text)" }}>
            {pct}%
          </p>
        )}
      </div>

      {children}
    </Card>
  );
}
