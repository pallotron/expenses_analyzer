import type { SuggestResponse } from "../lib/types";
import { merchantCount } from "./count";

/** The toast after "Suggest categories". */
export function suggestMessage(r: SuggestResponse): string {
  if (r.asked === 0) return "No uncategorized merchants";
  const parts = [`Suggested categories for ${merchantCount(r.suggested)}`];
  if (r.newCategories.length > 0) parts.push(`new: ${r.newCategories.join(", ")}`);
  if (r.unanswered > 0) parts.push(`${r.unanswered} got no answer`);
  return parts.join(" · ");
}
