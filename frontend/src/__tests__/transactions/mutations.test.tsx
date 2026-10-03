/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDelete } from "../../transactions/edit/mutations";

afterEach(() => vi.unstubAllGlobals());

describe("mutations", () => {
  it("invalidates every list a write can change", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ deleted: 1 }), { status: 200 })));
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDelete(), { wrapper });
    result.current.mutate([1]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["transactions"], ["summary"], ["periods"], ["lookups"]]);
  });
});
