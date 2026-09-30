/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_PATH, TopBar } from "../TopBar";

function renderBar(hostname: string, me: object | null = { email: "a@example.com", displayName: "Alex" }) {
  vi.stubGlobal("fetch", vi.fn(async () => me
    ? new Response(JSON.stringify(me), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TopBar hostname={hostname} /></QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("TopBar", () => {
  it("names the signed-in user and links to the Access logout", async () => {
    renderBar("expenses.example.com");
    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign out/i })).toHaveAttribute("href", LOGOUT_PATH);
  });

  it("uses the Access logout path on the app's own origin", () => {
    expect(LOGOUT_PATH).toBe("/cdn-cgi/access/logout");
  });

  it("hides sign-out on localhost, where there is no Access session to end", async () => {
    renderBar("localhost");
    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("still offers sign-out when /api/me fails", async () => {
    renderBar("expenses.example.com", null);
    expect(await screen.findByRole("link", { name: /sign out/i })).toBeInTheDocument();
  });
});
