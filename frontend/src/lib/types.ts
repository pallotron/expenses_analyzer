/** The Worker's API types, shared rather than copied, so the two cannot drift. */
export type {
  CategoryItem, Grid, GridCell, GridRow, Trend, MerchantItem, MonthTotals, PeriodsResponse, SummaryResponse,
} from "../../../worker/src/api/summary";
export { averageCents, monthTrends } from "../../../worker/src/api/summary";

export type {
  BudgetKind, DrillTarget, LookupsResponse, TransactionRow, TransactionsQuery, TransactionsResponse, TransactionType,
} from "../../../worker/src/api/transactions";
export { drillDown, monthRange, quote, toTransactionsSearch } from "../../../worker/src/api/transactions";
export type {
  BulkEdit, BulkEditRequest, DeletedResponse, RestoredResponse, TaggedResponse, TagRequest, TransactionEdit, UpdatedResponse,
} from "../../../worker/src/api/transactions";
// The tag sheet applies the Worker's exact tag rule; the module is pure.
export { normalizeTags } from "../../../worker/src/domain/tags";
