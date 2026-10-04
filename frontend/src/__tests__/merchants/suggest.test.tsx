/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { suggestMessage } from "../../merchants/suggest";
import { api, merchant, renderMerchants, useHarness } from "./harness";

useHarness();

const lookups = (gemini: boolean) => () => ({
  body: { categories: ["Groceries"], tags: [], sources: [], essentialCategories: [], gemini },
});
const rows = [merchant(1, "Corner Shop", { category: null }), merchant(2, "Bakery")];
const button = () => screen.queryByRole("button", { name: "Suggest categories" });

describe("suggestMessage", () => {
  it.each([
    [{ asked: 0, suggested: 0, newCategories: [], unanswered: 0 }, "No uncategorized merchants"],
    [{ asked: 1, suggested: 1, newCategories: [], unanswered: 0 }, "Suggested categories for 1 merchant"],
    [{ asked: 4, suggested: 3, newCategories: ["Pets", "Hobbies"], unanswered: 1 },
      "Suggested categories for 3 merchants · new: Pets, Hobbies · 1 got no answer"],
  ])("%j", (r, message) => expect(suggestMessage(r)).toBe(message));
});

describe("the Suggest categories button", () => {
  it("is hidden when Gemini is not set up", async () => {
    renderMerchants("/merchants", api(rows, { "GET /api/lookups": lookups(false) }));
    await screen.findByRole("table");
    expect(button()).not.toBeInTheDocument();
  });

  it("is hidden when every merchant has a category", async () => {
    renderMerchants("/merchants", api([merchant(1, "Corner Shop"), merchant(2, "Bakery")], { "GET /api/lookups": lookups(true) }));
    await screen.findByRole("table");
    expect(button()).not.toBeInTheDocument();
  });

  it("shows for a merchant that only has a rule", async () => {
    renderMerchants("/merchants", api(
      [merchant(1, "Corner Shop", { category: null, count: 0, rules: [{ id: 1, pattern: "^C" }] }), merchant(2, "Bakery")],
      { "GET /api/lookups": lookups(true) },
    ));
    expect(await screen.findByRole("button", { name: "Suggest categories" })).toBeInTheDocument();
  });

  it("asks, shows the result, and Review switches to the Suggested filter", async () => {
    const mock = renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/suggest": () => ({ body: { asked: 1, suggested: 1, newCategories: ["Pets"], unanswered: 0 } }),
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.path === "/api/merchants/suggest")).toBe(true));
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Suggested categories for 1 merchant · new: Pets"));
    await userEvent.click(within(toast).getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("location")).toHaveTextContent("attention=suggested");
  });

  it("is disabled and says so while Gemini is thinking", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = api(rows, { "GET /api/lookups": lookups(true) });
    const slow = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/merchants/suggest")) {
        await gate;
        return new Response(JSON.stringify({ asked: 1, suggested: 0, newCategories: [], unanswered: 1 }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return mock.fetch(input, init);
    };
    renderMerchants("/merchants", { ...mock, fetch: slow });
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    expect(await screen.findByRole("button", { name: "Asking Gemini…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 got no answer"));
  });

  it("shows the Worker's message with Retry when it fails", async () => {
    let attempts = 0;
    renderMerchants("/merchants", api(rows, {
      "GET /api/lookups": lookups(true),
      "POST /api/merchants/suggest": () => (++attempts === 1
        ? { status: 502, body: { error: "Gemini didn't answer (HTTP 429)" } }
        : { body: { asked: 1, suggested: 1, newCategories: [], unanswered: 0 } }),
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    const toast = screen.getByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent("Gemini didn't answer (HTTP 429)"));
    await userEvent.click(within(toast).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(toast).toHaveTextContent("Suggested categories for 1 merchant"));
    expect(attempts).toBe(2);
  });

  it("Retry goes away while the retried request is in flight, and sends one extra POST", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let attempts = 0;
    const mock = api(rows, { "GET /api/lookups": lookups(true) });
    const flaky = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/merchants/suggest")) {
        if (++attempts === 1) {
          return new Response(JSON.stringify({ error: "Gemini didn't answer (HTTP 429)" }),
            { status: 502, headers: { "content-type": "application/json" } });
        }
        await gate;
        return new Response(JSON.stringify({ asked: 1, suggested: 0, newCategories: [], unanswered: 1 }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return mock.fetch(input, init);
    };
    renderMerchants("/merchants", { ...mock, fetch: flaky });
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    await userEvent.click(retry);
    expect(await screen.findByRole("button", { name: "Asking Gemini…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(attempts).toBe(2);
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 got no answer"));
    expect(attempts).toBe(2);
  });

  it("a second click on the main button while pending sends no extra POST", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let attempts = 0;
    const mock = api(rows, { "GET /api/lookups": lookups(true) });
    const slow = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/merchants/suggest")) {
        attempts++;
        await gate;
        return new Response(JSON.stringify({ asked: 1, suggested: 0, newCategories: [], unanswered: 1 }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
      return mock.fetch(input, init);
    };
    renderMerchants("/merchants", { ...mock, fetch: slow });
    await userEvent.click(await screen.findByRole("button", { name: "Suggest categories" }));
    const pending = await screen.findByRole("button", { name: "Asking Gemini…" });
    await userEvent.click(pending);
    release();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 got no answer"));
    expect(attempts).toBe(1);
  });
});
