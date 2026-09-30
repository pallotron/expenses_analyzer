/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SummaryPage } from "../../summary/SummaryPage";
import { mockApi, summary } from "./fixtures";

let location = "";
function LocationProbe() {
  location = useLocation().search;
  return null;
}

function renderAt(url: string, api = mockApi()) {
  vi.stubGlobal("fetch", vi.fn(api.fetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <SummaryPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return api;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("SummaryPage", () => {
  it("opens on the newest year and shows its figures", async () => {
    const api = renderAt("/");
    expect(await screen.findByText("€61,400.00")).toBeInTheDocument();
    expect(api.calls.some((u) => u.pathname === "/api/summary" && u.searchParams.get("year") === "2026")).toBe(true);
  });

  it("moves to a month when its chip is pressed, and puts it in the URL", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: "Feb" }));
    await waitFor(() => expect(location).toContain("month=2"));
    expect(api.calls.some((u) => u.searchParams.get("month") === "2")).toBe(true);
  });

  it("refetches with hidden tags included when toggled", async () => {
    const api = renderAt("/?year=2026");
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("switch", { name: /include hidden tags/i }));
    await waitFor(() => expect(api.calls.some((u) => u.searchParams.get("hidden") === "1")).toBe(true));
  });

  it("shows what the exclusion hides", async () => {
    renderAt("/?year=2026");
    expect(await screen.findByText(/excluding emergency/i)).toHaveTextContent("€1,240.00 hidden");
  });

  it("says so when there is no data at all", async () => {
    renderAt("/", mockApi({ periods: { years: [], sources: [] } }));
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it("shows an error with a retry button when the API fails", async () => {
    renderAt("/?year=2026", mockApi({ status: 500 }));
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("filters sources, including selecting none", async () => {
    const api = renderAt("/?year=2026", mockApi({ summary: () => summary() }));
    await screen.findByText("€61,400.00");
    await userEvent.click(screen.getByRole("button", { name: /sources/i }));
    await userEvent.click(within(screen.getByRole("group", { name: /sources/i })).getByRole("button", { name: "None" }));
    await waitFor(() => expect(api.calls.some((u) =>
      u.searchParams.has("sources") && u.searchParams.getAll("sources").join() === "")).toBe(true));
    expect(location).toContain("sources=");
  });
});
