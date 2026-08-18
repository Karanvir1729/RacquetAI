import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Section rhythm, ported from Daybot: a single column at `max-w-shell`,
 * generous vertical padding, backgrounds ALTERNATING between `--rq-bg` and
 * `--rq-panel`, each separated by a 1px `--rq-line` top border. That quiet
 * banding is most of what makes the page feel premium — keep alternating.
 */

interface SectionProps {
  children: ReactNode;
  /** `panel` is the raised band; alternate it with `bg` down the page. */
  tone?: "bg" | "panel";
  id?: string;
  className?: string;
  /** Inner container width. `prose` narrows for FAQ-style reading columns. */
  width?: "shell" | "prose";
  /** Tighter band for interstitials (support strips, footers). */
  compact?: boolean;
  /** The hero owns its own top edge; everything else gets the hairline. */
  divider?: boolean;
}

export function Section({
  children,
  tone = "bg",
  id,
  className,
  width = "shell",
  compact = false,
  divider = true,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(divider && "border-t", id && "scroll-mt-20", className)}
      style={{
        borderColor: "var(--rq-line)",
        background: tone === "panel" ? "var(--rq-panel)" : "var(--rq-bg)",
      }}
    >
      <div
        className={cn(
          "mx-auto px-5 sm:px-6 lg:px-8",
          width === "prose" ? "max-w-3xl" : "max-w-shell",
          compact ? "py-14 sm:py-16" : "py-16 sm:py-20 lg:py-24",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Eyebrow + headline + optional standfirst — the head of every section. */
export function SectionHead({
  eyebrow,
  title,
  body,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" && "text-center", className)}>
      <p className="rq-eyebrow">{eyebrow}</p>
      <h2 className={cn("rq-h2 mt-3 max-w-3xl", align === "center" && "mx-auto")}>{title}</h2>
      {body ? (
        <p className={cn("rq-lead mt-5 max-w-2xl", align === "center" && "mx-auto")}>{body}</p>
      ) : null}
    </div>
  );
}
