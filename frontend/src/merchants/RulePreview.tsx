import { formatCents } from "../lib/money";
import type { AliasPreviewResponse } from "../lib/types";

/** What the pattern would claim, in words. Silent when it matches nothing. */
export function RulePreview(props: { preview: AliasPreviewResponse | undefined; category: string; tags: string[] }) {
  const p = props.preview;
  if (!p || p.matched === 0) return null;
  const current = Object.entries(p.currentCategories).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(", ");
  const claims = Object.keys(p.merchants).sort().join(", ");
  return (
    <section aria-label="Preview" className="flex flex-col gap-1 rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <p>Matches {p.matched} transactions · {formatCents(p.totalCents)}</p>
      {current && <p>Currently {current}{props.category && ` → ${props.category}`}</p>}
      {claims && <p>Claims: {claims}</p>}
      {props.tags.length > 0 && <p>+ tags {p.matched} rows: {props.tags.join(", ")}</p>}
    </section>
  );
}
