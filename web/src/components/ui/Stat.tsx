import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A measured number with its label. Figures are tabular so a value that ticks
 * during video playback doesn't shift the layout under it.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p
        className="text-[11px] font-extrabold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--rq-text-faint)" }}
      >
        {label}
      </p>
      <p className="rq-num mt-1.5 flex items-baseline gap-1 text-[28px] font-extrabold leading-none">
        {value}
        {unit ? (
          <span className="text-[15px] font-bold" style={{ color: "var(--rq-text-dim)" }}>
            {unit}
          </span>
        ) : null}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A 0..1 bar in Optic on a hairline track. */
export function Meter({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-rq-pill"
      style={{ background: "var(--rq-line)" }}
      role="img"
      aria-label={label ?? `${Math.round(pct)} percent`}
    >
      <div
        className="h-full rounded-rq-pill"
        style={{ width: `${pct}%`, background: "var(--rq-data)" }}
      />
    </div>
  );
}
