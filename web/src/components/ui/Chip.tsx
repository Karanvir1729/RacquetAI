import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** A pill of accent-soft with accent text — the badge above a hero headline. */
export function AccentBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-rq-pill border px-3.5 py-1.5 text-[13px] font-bold",
        className,
      )}
      style={{
        borderColor: "var(--rq-accent-line)",
        background: "var(--rq-accent-soft)",
        color: "var(--rq-accent-text)",
      }}
    >
      {children}
    </span>
  );
}

/** A neutral hairline chip — trust row items, metadata, filter pills. */
export function Chip({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-rq-sm border px-3 py-2 text-[13px] font-semibold",
        className,
      )}
      style={{
        borderColor: "var(--rq-line)",
        background: "var(--rq-card)",
        color: "var(--rq-text-dim)",
      }}
    >
      {icon ? <span style={{ color: "var(--rq-accent-text)" }}>{icon}</span> : null}
      {children}
    </span>
  );
}

/** A floating, blurred chip that hovers over the hero visual. */
export function GlassChip({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-rq-sm border px-3 py-2 text-[12.5px] font-bold backdrop-blur-md",
        className,
      )}
      style={{
        borderColor: "var(--rq-line-2)",
        background: "var(--rq-chip)",
        color: "var(--rq-text)",
        boxShadow: "var(--rq-card-shadow)",
        whiteSpace: "nowrap",
      }}
    >
      {icon ? <span style={{ color: "var(--rq-accent-text)" }}>{icon}</span> : null}
      {children}
    </span>
  );
}
