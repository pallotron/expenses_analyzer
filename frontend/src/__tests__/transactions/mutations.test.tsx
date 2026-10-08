/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../../lib/queryClient";
import { useAskGemini } from "../../merchants/mutations";
import { useDelete } from "../../transactions/edit/mutations";

afterEach(() => vi.unstubAllGlobals());

function setup(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  const client = createQueryClient();
  for (const key of ["transactions", "summary", "budget-types", "import-sources", "me"]) client.setQueryData([key], {});
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const stale = () => client.getQueryCache().getAll().filter((q) => q.state.isInvalidated).map((q) => q.queryKey[0]).sort();
  return { wrapper, stale };
}

describe("mutations", () => {
  it("a write marks every data query stale, since views are fetched once per visit", async () => {
    const { wrapper, stale } = setup({ deleted: 1, ids: [1] });
    const { result } = renderHook(() => useDelete(), { wrapper });
    result.current.mutate([1]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual(["budget-types", "import-sources", "summary", "transactions"]);
  });

  it("asking Gemini saves nothing, so nothing goes stale", async () => {
    const { wrapper, stale } = setup({ suggestions: [] });
    const { result } = renderHook(() => useAskGemini(), { wrapper });
    result.current.mutate([1]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stale()).toEqual([]);
  });
});
