import { send } from "../lib/api";
import type { HiddenTagsBody } from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

/** The patterns decide which rows the Summary totals and its drill-downs show. */
export const useSaveHiddenTags = () =>
  useWrite((body: HiddenTagsBody) => send<HiddenTagsBody>("POST", "/api/summary/hidden-tags", body), ["summary", "transactions"]);
