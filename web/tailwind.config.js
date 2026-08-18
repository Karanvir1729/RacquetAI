/**
 * Tailwind is the layout engine only. Every colour is bound to a `--rq-*`
 * custom property (src/styles/tokens.css) so `text-rq-dim` and
 * `style={{ color: "var(--rq-text-dim)" }}` are the same thing, and neither
 * hardcodes a hex. Adding a literal colour here defeats the theme switch.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rq: {
          bg: "var(--rq-bg)",
          panel: "var(--rq-panel)",
          card: "var(--rq-card)",
          raised: "var(--rq-card-raised)",
          chip: "var(--rq-chip)",
          line: "var(--rq-line)",
          line2: "var(--rq-line-2)",
          text: "var(--rq-text)",
          dim: "var(--rq-text-dim)",
          faint: "var(--rq-text-faint)",
          accent: "var(--rq-accent)",
          "accent-text": "var(--rq-accent-text)",
          "accent-soft": "var(--rq-accent-soft)",
          "on-accent": "var(--rq-on-accent)",
          danger: "var(--rq-danger)",
          "danger-soft": "var(--rq-danger-soft)",
        },
      },
      borderRadius: {
        // The app's radius scale (src/theme/tokens.ts): 10 / 14 / 20 / 28 / pill.
        "rq-sm": "var(--rq-r-sm)",
        "rq-md": "var(--rq-r-md)",
        "rq-lg": "var(--rq-r-lg)",
        "rq-xl": "var(--rq-r-xl)",
        "rq-pill": "var(--rq-r-pill)",
      },
      boxShadow: {
        "rq-card": "var(--rq-card-shadow)",
        "rq-lift": "var(--rq-lift-shadow)",
      },
      fontFamily: {
        // RacquetIQ ships no custom font — the platform UI face, as on iOS.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["SF Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        shell: "80rem",
      },
      transitionTimingFunction: {
        rq: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
