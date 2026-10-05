/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_PATH, TopBar } from "../TopBar";

function renderBar(hostname: string, me: object | null = { email: "a@example.com", displayName: "Alex" }, path = "/") {
  vi.stubGlobal("fetch", vi.fn(async () => me
    ? new Response(JSON.stringify(me), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><TopBar hostname={hostname} /></MemoryRouter></QueryClientProvider>);
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

  it("links to every screen and marks the current one", async () => {
    renderBar("expenses.example.com", undefined, "/transactions");
    expect(screen.getByRole("link", { name: "Summary" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Merchants" })).toHaveAttribute("href", "/merchants");
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute("href", "/budgets");
  });

  it("publishes the measured bar height as --topbar-h", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      cb: (e: unknown[]) => void;
      constructor(cb: (e: unknown[]) => void) { this.cb = cb; }
      observe() { this.cb([{ borderBoxSize: [{ blockSize: 68 }] }]); }
      disconnect = disconnect;
    });
    const { unmount } = renderBar("localhost");
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("68px");
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("");
  });
});
