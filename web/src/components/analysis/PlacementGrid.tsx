import { cellLabel } from "@/analysis/format";
import { COURT_CELLS, type Placement } from "@/analysis/types";

/**
 * Where a player's shots landed, as the 2x2 the contract defines: front row is
 * the front-wall end, matching the court plan directly beside it so the two
 * read as the same court seen the same way up.
 *
 * The fill is proportional to the busiest quadrant rather than to the total —
 * on a 66/64/15/11 split (which is what real club footage looks like) a
 * total-relative ramp leaves both front cells indistinguishable from empty.
 */
export function PlacementGrid({ placement }: { placement: Placement }) {
  const total = COURT_CELLS.reduce((sum, cell) => sum + placement[cell], 0);
  const busiest = Math.max(...COURT_CELLS.map((cell) => placement[cell]), 1);

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {COURT_CELLS.map((cell) => {
          const count = placement[cell];
          const share = count / busiest;
          return (
            <div
              key={cell}
              className="rounded-rq-sm border px-3 py-3"
              style={{
                borderColor: "var(--rq-line)",
                background: `color-mix(in srgb, var(--rq-data) ${Math.round(share * 18)}%, transparent)`,
              }}
            >
              <p className="text-[11px] font-semibold" style={{ color: "var(--rq-text-dim)" }}>
                {cellLabel(cell)}
              </p>
              <p className="rq-num mt-0.5 text-[20px] font-extrabold leading-tight">
                {count}
                <span
                  className="ml-1.5 text-[11px] font-semibold"
                  style={{ color: "var(--rq-text-faint)" }}
                >
                  {total > 0 ? `${Math.round((count / total) * 100)}%` : "—"}
                </span>
              </p>
            </div>
          );
        })}
      </div>
      <p className="rq-caption mt-2">Front of the court is the top row.</p>
    </div>
  );
}
