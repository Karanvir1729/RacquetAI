import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The uniform card recipe, ported from Daybot's: a large radius, a single
 * hairline, the card surface, and one shadow token. Every tile on the site is
 * this shape — features, steps, stats, FAQ rows — which is what makes the page
 * read as one system rather than a pile of boxes.
 *
 * `featured` swaps the hairline for Optic and the fill for accent-soft; use it
 * for exactly one card in a group or it stops meaning anything.
 */

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Optic hairline + accent-soft fill. One per group, at most. */
  featured?: boolean;
  /** A hover lift. Only for cards that are actually links or buttons. */
  interactive?: boolean;
  as?: "div" | "article" | "li";
}

export function Card({
  children,
  className,
  style,
  featured = false,
  interactive = false,
  as: Tag = "div",
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-rq-lg border shadow-rq-card",
        interactive && "transition-transform duration-300 ease-rq hover:-translate-y-1",
        className,
      )}
      style={{
        borderColor: featured ? "var(--rq-accent-line)" : "var(--rq-line)",
        background: featured ? "var(--rq-accent-soft)" : "var(--rq-card)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * The accent icon chip that sits at the top of most cards: a rounded square of
 * `--rq-accent-soft` tinted `--rq-accent-text` (never `--rq-accent`, which is
 * unreadable as ink on a light surface).
 *
 * `tone="danger"` is the same chip in the status palette, for the cards that
 * report a failure rather than a feature.
 */
export function IconChip({
  children,
  className,
  tone = "accent",
}: {
  children: ReactNode;
  className?: string;
  tone?: "accent" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-rq-sm",
        className,
      )}
      style={
        tone === "danger"
          ? { background: "var(--rq-danger-soft)", color: "var(--rq-danger)" }
          : { background: "var(--rq-accent-soft)", color: "var(--rq-accent-text)" }
      }
    >
      {children}
    </span>
  );
}

/** A hairline rule. The site's only divider — 1px of `--rq-line`, nothing else. */
export function Hairline({ className }: { className?: string }) {
  return <div className={cn("h-px w-full", className)} style={{ background: "var(--rq-line)" }} />;
}
