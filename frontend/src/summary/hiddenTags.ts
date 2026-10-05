import { formatCents } from "../lib/money";

/**
 * The hidden-tag sheet's rows, as the TUI's build_pattern_options lays them
 * out: a `ns:*` row per tag namespace, then every tag in use, then any hidden
 * pattern that no longer matches a tag, so it can still be unticked.
 */
export interface PatternOption {
  pattern: string;
  ticked: boolean;
}

export function patternOptions(tagsInUse: string[], excluded: string[]): PatternOption[] {
  const namespaces = [...new Set(tagsInUse.filter((t) => t.includes(":")).map((t) => `${t.split(":")[0]}:*`))].sort();
  const hidden = new Set(excluded);
  return [...new Set([...namespaces, ...tagsInUse, ...excluded])]
    .filter((p) => p !== "")
    .map((pattern) => ({ pattern, ticked: hidden.has(pattern) }));
}

/** What the exclusion leaves out of the totals, naming only the kinds it hides. */
export function hiddenText(expenseCents: number, incomeCents: number): string {
  if (expenseCents === 0 && incomeCents === 0) return "nothing hidden";
  if (incomeCents === 0) return `${formatCents(expenseCents)} expenses hidden`;
  if (expenseCents === 0) return `${formatCents(incomeCents)} income hidden`;
  return `${formatCents(expenseCents)} expenses and ${formatCents(incomeCents)} income hidden`;
}
