/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ImportAction } from "../../import/ImportAction";
import { ImportPage } from "../../import/ImportPage";
import type { ImportMapping } from "../../lib/types";
import { api, csvFile, useHarness } from "./harness";

useHarness();

const CSV = "Date,Description,Amount\n01/09/2026,Corner Shop,-12.50\n03/09/2026,Acme Payroll,2500\n";
const MAPPING: ImportMapping = { date: "Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const IMPORTED = { batchId: 7, inserted: 1, duplicates: 1, suppressedDeleted: 0, newMerchants: ["Corner Shop"] };

function renderWithAction(mock: ReturnType<typeof api>) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/import"]}>
        <ImportPage renderAction={(ready, reset) => <ImportAction ready={ready} onReset={reset} />} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

async function ready() {
  await screen.findByLabelText("Source");
  await userEvent.upload(screen.getByLabelText("File"), csvFile(CSV));
  await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
  return screen.findByRole("button", { name: "Import 2 transactions" });
}

const posts = (mock: ReturnType<typeof api>, path: string) =>
  mock.calls.filter((c) => c.method === "POST" && c.path === path).map((c) => c.body);

describe("importing", () => {
  it("offers no Import button until a source is chosen", async () => {
    renderWithAction(api({ mappings: { Card: MAPPING } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CSV));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /^Import/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    expect(await screen.findByRole("button", { name: "Import 2 transactions" })).toBeInTheDocument();
  });

  it("sends the parsed rows with the source, file name and mapping, and shows the result", async () => {
    const mock = renderWithAction(api({ mappings: { Card: MAPPING }, routes: { "POST /api/import": () => ({ body: IMPORTED }) } }));
    await userEvent.click(await ready());
    await waitFor(() => expect(posts(mock, "/api/import")).toEqual([{
      source: "Card", filename: "sept.csv", mapping: MAPPING,
      rows: [
        { date: "2026-09-01", merchant: "Corner Shop", amountCents: 1250, type: "expense" },
        { date: "2026-09-03", merchant: "Acme Payroll", amountCents: 250000, type: "income" },
      ],
    }]));
    expect(await screen.findByText("Imported 1 · 1 already there · 0 previously deleted · 1 new merchant")).toBeInTheDocument();
    const view = screen.getByRole("link", { name: "View in Transactions" });
    expect(view.getAttribute("href")).toBe("/transactions?from=2026-09-01&to=2026-09-03&sources=Card");
  });

  it("does not offer Gemini without a key", async () => {
    renderWithAction(api({ gemini: false, mappings: { Card: MAPPING } }));
    await ready();
    expect(screen.queryByLabelText("Suggest categories for new merchants")).not.toBeInTheDocument();
  });

  it("suggests categories for new merchants when ticked, and keeps the import when that fails", async () => {
    let attempts = 0;
    const mock = renderWithAction(api({
      gemini: true, mappings: { Card: MAPPING },
      routes: {
        "POST /api/import": () => ({ body: IMPORTED }),
        "POST /api/merchants/suggest": () => (++attempts === 1
          ? { status: 502, body: { error: "Gemini didn't answer (HTTP 429)" } }
          : { body: { asked: 1, suggested: 1, newCategories: [], unanswered: 0 } }),
      },
    }));
    await ready();
    expect(screen.getByLabelText("Suggest categories for new merchants")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Import 2 transactions" }));
    expect(await screen.findByText("Gemini didn't answer (HTTP 429)")).toBeInTheDocument();
    expect(screen.getByText(/^Imported 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Suggested categories for 1 merchant")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review suggestions" })).toHaveAttribute("href", "/merchants?attention=suggested");
    expect(posts(mock, "/api/merchants/suggest")).toHaveLength(2);
  });

  it("skips Gemini when the import made no new merchants", async () => {
    const mock = renderWithAction(api({
      gemini: true, mappings: { Card: MAPPING },
      routes: { "POST /api/import": () => ({ body: { ...IMPORTED, newMerchants: [] } }) },
    }));
    await userEvent.click(await ready());
    await screen.findByText(/^Imported 1/);
    expect(posts(mock, "/api/merchants/suggest")).toEqual([]);
  });

  it("lists the Worker's refusals and saves nothing", async () => {
    renderWithAction(api({
      mappings: { Card: MAPPING },
      routes: { "POST /api/import": () => ({ status: 400, body: {
        error: "The file has rows the import refuses", errors: ["Found 1 date(s) after maximum allowed date 2027-10-04"],
      } }) },
    }));
    await userEvent.click(await ready());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The file has rows the import refuses");
    expect(alert).toHaveTextContent("Found 1 date(s) after maximum allowed date 2027-10-04");
  });

  it("disables the button with nothing to import or too much", async () => {
    renderWithAction(api({ mappings: { Card: MAPPING } }));
    await screen.findByLabelText("Source");
    await userEvent.upload(screen.getByLabelText("File"), csvFile("Date,Description,Amount\n01/09/2026,Shop,0\n"));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    expect(await screen.findByRole("button", { name: "Nothing to import" })).toBeDisabled();
  });

  it("refuses more than 5,000 rows with the split message", async () => {
    renderWithAction(api({ mappings: { Card: MAPPING } }));
    await screen.findByLabelText("Source");
    const lines = Array.from({ length: 5_001 }, (_, i) => `01/09/2026,Shop ${i},-1.00`).join("\n");
    await userEvent.upload(screen.getByLabelText("File"), csvFile(`Date,Description,Amount\n${lines}\n`));
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Card");
    expect(await screen.findByRole("button", { name: "Split the file: at most 5,000 rows per import" })).toBeDisabled();
  });

  it("starts over with Import another file", async () => {
    renderWithAction(api({ mappings: { Card: MAPPING }, routes: { "POST /api/import": () => ({ body: IMPORTED }) } }));
    await userEvent.click(await ready());
    await userEvent.click(await screen.findByRole("button", { name: "Import another file" }));
    expect(screen.queryByRole("table", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("drops the result when another file is picked or the source changes", async () => {
    renderWithAction(api({ sources: ["Card", "Cash"], mappings: { Card: MAPPING }, routes: { "POST /api/import": () => ({ body: IMPORTED }) } }));
    await userEvent.click(await ready());
    await screen.findByText(/^Imported 1/);
    await userEvent.upload(screen.getByLabelText("File"), csvFile(CSV));
    expect(await screen.findByRole("button", { name: "Import 2 transactions" })).toBeInTheDocument();
    expect(screen.queryByText(/^Imported 1/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Import 2 transactions" }));
    await screen.findByText(/^Imported 1/);
    await userEvent.selectOptions(screen.getByLabelText("Source"), "Cash");
    expect(screen.queryByText(/^Imported 1/)).not.toBeInTheDocument();
  });

  it("links to the imported source and dates", async () => {
    renderWithAction(api({ mappings: { Card: MAPPING }, routes: { "POST /api/import": () => ({ body: IMPORTED }) } }));
    await userEvent.click(await ready());
    const view = await screen.findByRole("link", { name: "View in Transactions" });
    expect(view.getAttribute("href")).toBe("/transactions?from=2026-09-01&to=2026-09-03&sources=Card");
  });
});
