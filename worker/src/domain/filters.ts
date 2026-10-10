/**
 * The Transactions screen's filters: transaction_filter.py plus the screen's
 * budget filter, held to the Python by python_vectors.json (the Python app's answers, frozen).
 *
 * Text filters are case-insensitive substring matches, except that a value in
 * double quotes must match the whole field. That is how a Summary drill-down
 * asks for merchant "NS" without also getting "Bunsen". For tags the field is
 * the whole comma-separated cell, so a quoted tag only matches a row carrying
 * that tag alone.
 *
 * Text matching runs here rather than in SQL: SQLite's lower() only folds
 * ASCII, and merchant names are not all ASCII.
 */

export interface TransactionFilter {
  /** YYYY-MM-DD, inclusive. Anything else is ignored, as a bad date was. */
  dateFrom?: string;
  dateTo?: string;
  merchant?: string;
  category?: string;
  source?: string;
  /** Substring of the sorted, comma-separated tag cell. */
  tags?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
  type?: "expense" | "income";
  budget?: "essential" | "discretionary";
  /**
   * Applied in SQL by listTransactions, not by applyFilters: the Summary's
   * rules, which are not the TUI screen's. Undefined is every source; [] none.
   */
  sources?: string[];
  /** Hide the rows v_summary hides (tag exclusion patterns). */
  excludeHidden?: boolean;
}

export interface FilterableRow {
  /** YYYY-MM-DD. */
  date: string;
  merchant: string;
  amountCents: number;
  source: string;
  category: string;
  type: string;
  tags: string;
  budget: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The text inside a "quoted" value, or null if it is not quoted. */
function unquote(value: string): string | null {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : null;
}

/**
 * pandas' str.contains(case=False, regex=False) compares upper-cased text; the
 * exact match compared casefold()ed text, which toLowerCase approximates.
 */
export function matchesText(field: string, query: string | undefined): boolean {
  if (!query) return true;
  const exact = unquote(query);
  if (exact !== null) return field.toLowerCase() === exact.toLowerCase();
  return field.toUpperCase().includes(query.toUpperCase());
}

/**
 * An amount filter as typed. Returns undefined for anything that is not a
 * number, so the filter is skipped (pd.to_numeric(errors="coerce") gave NaN).
 */
export function parseAmountFilter(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

export function applyFilters<T extends FilterableRow>(rows: T[], filter: TransactionFilter): T[] {
  const from = filter.dateFrom && ISO_DATE.test(filter.dateFrom) ? filter.dateFrom : undefined;
  const to = filter.dateTo && ISO_DATE.test(filter.dateTo) ? filter.dateTo : undefined;
  return rows.filter((row) =>
    (from === undefined || row.date >= from)
    && (to === undefined || row.date <= to)
    && matchesText(row.merchant, filter.merchant)
    && (filter.amountMinCents === undefined || row.amountCents >= filter.amountMinCents)
    && (filter.amountMaxCents === undefined || row.amountCents <= filter.amountMaxCents)
    && matchesText(row.source, filter.source)
    && matchesText(row.category, filter.category)
    && (!filter.type || row.type === filter.type)
    && matchesText(row.tags, filter.tags)
    && (!filter.budget || row.budget === filter.budget));
}
