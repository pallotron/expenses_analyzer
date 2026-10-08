import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/**
 * Each view is fetched once per visit. The data only changes through this
 * app's own writes, and every write marks every view stale (`invalidateData`),
 * so refetching on focus or after a minute only re-read D1 to show the same
 * figures: a Summary costs ~130k D1 rows read, against a free-plan limit of
 * 5M a day. A change made on another device shows after a reload.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
      },
    },
  });
}

/**
 * After a write: every view is stale except who is signed in. Only the views
 * on screen refetch now; the rest refetch when next opened. Marking all of
 * them, rather than a list per write, is what makes fetching once safe.
 */
export function invalidateData(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
}
