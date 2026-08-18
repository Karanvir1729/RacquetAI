import { useId } from "react";

import { cn } from "@/lib/cn";

/**
 * The RacquetIQ mark — "Ace Spark". Geometry is a straight copy of the
 * canonical block between the `@mark-geometry` markers in
 * `assets/brand/src/mark.svg`; if that file changes, mirror it here.
 *
 * Colour is NOT copied: the SVG hardcodes Optic + Chalk, which vanishes on the
 * light Chalk Wash canvas. Here the frame reads `--rq-mark` and the spark
 * `--rq-mark-spark`, which resolve to Optic + Chalk on ink and to a Court Ink
 * mono mark on light — the substitution docs/04-branding.md §2 calls for.
 */
export function Mark({ size = 32, className }: { size?: number; className?: string }) {
  // Two marks on one page (header + footer) must not share a clipPath id.
  const bedId = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="RacquetIQ"
      focusable="false"
    >
      <defs>
        <clipPath id={bedId}>
          <path d="M 0 -166 C 33.69 -166 61 -130.63 61 -87 C 61 -43.37 33.69 -8 0 -8 C -33.69 -8 -61 -43.37 -61 -87 C -61 -130.63 -33.69 -166 0 -166 Z" />
        </clipPath>
      </defs>
      <g transform="translate(235.25 256.85) rotate(20) scale(1.0416)">
        <ellipse
          cx="0"
          cy="-87"
          rx="78"
          ry="96"
          fill="none"
          stroke="var(--rq-mark)"
          strokeWidth="34"
        />
        <path
          d="M 66.24 -6 C 28.94 37.16 26 68.4 26 118 L 26 180 C 26 191.05 17.05 200 6 200 L -6 200 C -17.05 200 -26 191.05 -26 180 L -26 118 C -26 68.4 -28.94 37.16 -66.24 -6 Z"
          fill="var(--rq-mark)"
        />
        {/* String bed: group opacity, not stroke opacity — at stroke opacity
            every crossing doubles up and the bed reads as noise. */}
        <g
          clipPath={`url(#${bedId})`}
          opacity="0.18"
          stroke="var(--rq-mark)"
          strokeWidth="2.8"
          strokeLinecap="round"
        >
          <path d="M -58.5 -183 V 9 M -45.5 -183 V 9 M -32.5 -183 V 9 M -19.5 -183 V 9 M -6.5 -183 V 9 M 6.5 -183 V 9 M 19.5 -183 V 9 M 32.5 -183 V 9 M 45.5 -183 V 9 M 58.5 -183 V 9" />
          <path d="M -78 -158.5 H 78 M -78 -145.5 H 78 M -78 -132.5 H 78 M -78 -119.5 H 78 M -78 -106.5 H 78 M -78 -93.5 H 78 M -78 -80.5 H 78 M -78 -67.5 H 78 M -78 -54.5 H 78 M -78 -41.5 H 78 M -78 -28.5 H 78 M -78 -15.5 H 78" />
        </g>
        {/* The spark on the sweet spot — the one element that must win the eye. */}
        <path
          d="M -14.36 -126.47 C 0.14 -106.27 14.67 -99.49 39.47 -101.36 C 19.27 -86.86 12.49 -72.33 14.36 -47.53 C -0.14 -67.73 -14.67 -74.51 -39.47 -72.64 C -19.27 -87.14 -12.49 -101.67 -14.36 -126.47 Z"
          fill="var(--rq-mark-spark)"
        />
      </g>
    </svg>
  );
}

/**
 * The horizontal lockup. "Racquet" in text colour, "IQ" in accent text —
 * the colour break is the only separation, no space and no second capital
 * (the wordmark rule, carried over from assets/brand/src/wordmark.svg).
 */
export function Wordmark({ className, markSize = 30 }: { className?: string; markSize?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={markSize} />
      <span
        className="text-[21px] font-extrabold"
        style={{ letterSpacing: "-0.035em", color: "var(--rq-text)" }}
      >
        Racquet<span style={{ color: "var(--rq-accent-text)" }}>IQ</span>
      </span>
    </span>
  );
}
