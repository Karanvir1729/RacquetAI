import { shotTypeLabel } from "@/analysis/format";
import type { ShotTypeCount } from "@/analysis/shots";

/**
 * A player's shot mix. Bars rather than a pie: the interesting comparison is
 * "drives against everything else", and a length is easier to compare than an
 * angle.
 *
 * Renders nothing when the analysis carries no classes at all (a v1 file, or a
 * writer that declined to guess) — an empty chart would imply the player hit
 * no shots. "Unclassified" is a real bar, deliberately: it is the honest
 * measure of how much of the match the classifier would not commit on, and
 * hiding it would make the mix look more certain than it is.
 */
export function ShotTypeBars({ counts }: { counts: readonly ShotTypeCount[] }) {
  if (counts.length === 0) {
    return (
      <p className="rq-caption">
        This analysis carries no shot classes — only where each shot landed.
      </p>
    );
  }

  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const busiest = Math.max(...counts.map((item) => item.count), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {counts.map(({ type, count }) => {
        const share = total > 0 ? count / total : 0;
        return (
          <li key={type}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="text-[13px] font-semibold"
                style={{ color: type === "unknown" ? "var(--rq-text-faint)" : "var(--rq-text)" }}
              >
                {shotTypeLabel(type)}
              </span>
              <span className="rq-num text-[12.5px]" style={{ color: "var(--rq-text-dim)" }}>
                {count}
                <span style={{ color: "var(--rq-text-faint)" }}> · {Math.round(share * 100)}%</span>
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-rq-pill"
              style={{ background: "var(--rq-line)" }}
            >
              <div
                className="h-full rounded-rq-pill"
                style={{
                  width: `${(count / busiest) * 100}%`,
                  background: "var(--rq-data)",
                  // The unclassified bar is drawn back so it never out-shouts
                  // a class the pipeline actually committed to.
                  opacity: type === "unknown" ? 0.38 : 1,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
