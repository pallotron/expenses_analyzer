/** @vitest-environment jsdom */
import { focusManager, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createQueryClient, invalidateData } from "../../lib/queryClient";

describe("createQueryClient", () => {
  it("fetches a view once: not again on focus, nor on a later mount", async () => {
    const client = createQueryClient();
    const fetch = vi.fn(async () => "data");
    const View = () => <p>{useQuery({ queryKey: ["summary"], queryFn: fetch }).data}</p>;
    const { unmount } = render(<QueryClientProvider client={client}><View /></QueryClientProvider>);
    await screen.findByText("data");
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    unmount();
    render(<QueryClientProvider client={client}><View /></QueryClientProvider>);
    await screen.findByText("data");
    expect(fetch).toHaveBeenCalledOnce();
    focusManager.setFocused(undefined);
  });
});

describe("invalidateData", () => {
  it("marks every data query stale, but not who is signed in", async () => {
    const client = createQueryClient();
    for (const key of ["summary", "periods", "budget-types", "import-sources", "source-owners", "me"]) {
      client.setQueryData([key], {});
    }
    client.setQueryData(["transactions", "/api/transactions?from=2026-09-01"], {});
    await invalidateData(client);
    const stale = client.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey[0]);
    expect(stale.sort()).toEqual(["budget-types", "import-sources", "periods", "source-owners", "summary", "transactions"]);
  });
});
