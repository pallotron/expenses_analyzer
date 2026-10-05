/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountsPage } from "../../accounts/AccountsPage";

function setup(saveStatus?: number) {
  const posts: unknown[] = [];
  const owners = new Map<string, number | null>([["Bank A", 1], ["Card", null]]);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "POST") {
      if (saveStatus) return json({ error: "Nope" }, saveStatus);
      const body = JSON.parse(String(init.body));
      posts.push(body);
      owners.set(body.source, body.userId);
      return json({ ok: true });
    }
    if (url.pathname === "/api/source-owners") {
      return json({ sources: [...owners].map(([source, userId]) => ({ source, userId })), users: [{ id: 1, name: "A" }, { id: 2, name: "B" }] });
    }
    return json({});
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AccountsPage /></QueryClientProvider>);
  return { posts };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Accounts page", () => {
  it("shows each source's owner and saves a change", async () => {
    const { posts } = setup();
    const card = await screen.findByLabelText("Owner of Card");
    expect(screen.getByLabelText("Owner of Bank A")).toHaveValue("1");
    expect(card).toHaveValue("");
    await userEvent.selectOptions(card, "2");
    await waitFor(() => expect(posts).toEqual([{ source: "Card", userId: 2 }]));
    await userEvent.selectOptions(screen.getByLabelText("Owner of Bank A"), "");
    await waitFor(() => expect(posts[1]).toEqual({ source: "Bank A", userId: null }));
  });

  it("says why when a save fails", async () => {
    setup(500);
    await userEvent.selectOptions(await screen.findByLabelText("Owner of Card"), "2");
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
  });
});
