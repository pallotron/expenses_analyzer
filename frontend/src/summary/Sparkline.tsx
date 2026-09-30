import type { GridCell } from "../lib/types";

/** Twelve bars, anomalies in the anomaly colour. Inline SVG: there are dozens. */
export function Sparkline(props: { values: GridCell[]; label: string }) {
  const max = Math.max(1, ...props.values.map((v) => v.amountCents));
  const w = 4, gap = 2, h = 24;
  return (
    <svg role="img" aria-label={props.label} width={12 * (w + gap)} height={h} className="shrink-0">
      {props.values.map((v, i) => {
        const bh = v.amountCents > 0 ? Math.max(1.5, (v.amountCents / max) * h) : 1;
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1}
            className={v.anomaly ? "fill-anomaly" : v.amountCents > 0 ? "fill-slate-400 dark:fill-slate-500" : "fill-slate-200 dark:fill-slate-800"} />
        );
      })}
    </svg>
  );
}
