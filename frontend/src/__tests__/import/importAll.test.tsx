/** @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ImportMapping, ImportRequest, ImportSource } from "../../lib/types";
import { addFiles, api, asNew, csvFile, renderImport, statusOf, useHarness } from "./harness";

useHarness();

const CSV = "Started Date,Description,Amount\n2026-09-01 10:00:00,Corner Shop,-6.55\n2026-09-02 09:00:00,Acme Payroll,100.00\n";
const MAP: ImportMapping = { date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SOURCES: ImportSource[] = ["Alpha", "Beta", "Gamma"].map((name) => ({ name, lastDate: "2026-08-31", mapping: MAP }));

async function ready(files: [string, string][]) {
  await addFiles(files.map(([name]) => csvFile(CSV, name)));
  for (const [name, source] of files) {
    await userEvent.selectOptions(screen.getByLabelText(`Source for ${name}`), source);
  }
  for (const [name] of files) await waitFor(() => expect(statusOf(name)).toHaveTextContent("Ready"));
}
const importButton = () => screen.getByRole("button", { name: /^Import \d+ files? · / });

describe("importing the list", () => {
  it("imports every ready file in order, then shows one result", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"]]);
    expect(importButton()).toHaveTextContent("Import 2 files · 4 transactions");
    await userEvent.click(importButton());
    const result = await screen.findByRole("region", { name: "Import result" });
    expect(mock.imports(false).map((b) => b.source)).toEqual(["Alpha", "Beta"]);
    expect(within(result).getByText("Total").closest("tr")).toHaveTextContent("Total4");
    const link = within(result).getByRole("link", { name: "View in Transactions" });
    expect(link.getAttribute("href")).toContain("from=2026-09-01");
    expect(link.getAttribute("href")).toContain("to=2026-09-02");
  });

  it("keeps going after a failed file, and Retry imports just that file", async () => {
    let failBeta = true;
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => {
          const b = body as ImportRequest;
          if (!b.dryRun && b.source === "Beta" && failBeta) {
            return { status: 400, body: { error: "The file has rows the import refuses", errors: ["Found 1 bad date"] } };
          }
          return asNew(body);
        },
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"], ["c.csv", "Gamma"]]);
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    expect(statusOf("a.csv")).toHaveTextContent("Imported 2");
    expect(statusOf("b.csv")).toHaveTextContent("Failed: The file has rows the import refuses");
    expect(within(statusOf("b.csv")).getByText("Found 1 bad date")).toBeInTheDocument();
    expect(statusOf("c.csv")).toHaveTextContent("Imported 2");
    failBeta = false;
    await userEvent.click(within(statusOf("b.csv")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(statusOf("b.csv")).toHaveTextContent("Imported 2"));
    expect(mock.imports(false).map((b) => b.source)).toEqual(["Alpha", "Beta", "Gamma", "Beta"]);
  });

  it("re-checks a second file of the same source before importing it", async () => {
    const mock = renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Alpha"]]);
    const before = mock.calls.length;
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    const sequence = mock.calls.slice(before).filter((c) => c.path === "/api/import")
      .map((c) => `${(c.body as ImportRequest).dryRun ? "check" : "import"} ${(c.body as ImportRequest).filename}`);
    expect(sequence).toEqual(["import a.csv", "check b.csv", "import b.csv"]);
  });

  it("re-checks a later file of another source, since duplicates span sources", async () => {
    let imported = false;
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => {
          const b = body as ImportRequest;
          if (!b.dryRun) { imported = true; return asNew(body); }
          return imported
            ? { body: { batchId: null, inserted: 0, duplicates: b.rows.length, suppressedDeleted: 0, newMerchants: [] } }
            : asNew(body);
        },
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"]]);
    const before = mock.calls.length;
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    const sequence = mock.calls.slice(before).filter((c) => c.path === "/api/import")
      .map((c) => `${(c.body as ImportRequest).dryRun ? "check" : "import"} ${(c.body as ImportRequest).filename}`);
    expect(sequence).toEqual(["import a.csv", "check b.csv", "import b.csv"]);
  });

  it("re-checks a file left out of the run once something was imported", async () => {
    let checksOfB = 0;
    renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => {
          const b = body as ImportRequest;
          if (b.dryRun && b.filename === "b.csv" && ++checksOfB === 1) return { status: 500, body: { error: "Server error" } };
          return asNew(body);
        },
      },
    }));
    await addFiles([csvFile(CSV, "a.csv"), csvFile(CSV, "b.csv")]);
    await userEvent.selectOptions(screen.getByLabelText("Source for a.csv"), "Alpha");
    await userEvent.selectOptions(screen.getByLabelText("Source for b.csv"), "Beta");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready"));
    await waitFor(() => expect(statusOf("b.csv")).toHaveTextContent("Couldn't check"));
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    await waitFor(() => expect(statusOf("b.csv")).toHaveTextContent("Ready"));
    expect(checksOfB).toBe(2);
  });

  it("asks Gemini once for all the new merchants", async () => {
    const mock = renderImport(api({
      sources: SOURCES, gemini: true,
      routes: {
        "POST /api/import": (body) => ({ body: { ...asNew(body).body as object, newMerchants: ["Corner Shop"] } }),
        "POST /api/merchants/suggest": () => ({ body: { asked: 1, suggested: 1, newCategories: [], unanswered: 0 } }),
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Beta"]]);
    expect(screen.getByLabelText("Suggest categories for new merchants")).toBeChecked();
    await userEvent.click(importButton());
    const result = await screen.findByRole("region", { name: "Import result" });
    await within(result).findByRole("link", { name: "Review suggestions" });
    expect(mock.calls.filter((c) => c.path === "/api/merchants/suggest")).toHaveLength(1);
  });

  it("does not ask Gemini when no file has new merchants, or the box is unticked", async () => {
    const mock = renderImport(api({ sources: SOURCES, gemini: true }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    expect(mock.calls.filter((c) => c.path === "/api/merchants/suggest")).toHaveLength(0);
  });

  it("locks the list while importing, and warns before leaving", async () => {
    const pending: { finish?: () => void } = {};
    renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": (body) => ((body as ImportRequest).dryRun
          ? asNew(body)
          : new Promise((resolve) => { pending.finish = () => resolve(asNew(body)); })),
      },
    }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await waitFor(() => expect(pending.finish).toBeDefined());
    expect(screen.getByText("Keep this page open until the import finishes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Source for a.csv")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove a.csv" })).toBeDisabled();
    expect(screen.getByLabelText("Files")).toBeDisabled();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    pending.finish?.();
    await screen.findByRole("region", { name: "Import result" });
    expect(screen.getByLabelText("Files")).toBeEnabled();
  });

  it("does not import a file whose re-check fails, and still imports the others", async () => {
    let checksOfB = 0;
    let bWhenCImports = "";
    const mock = renderImport(api({
      sources: SOURCES,
      routes: {
        "POST /api/import": async (body) => {
          const b = body as ImportRequest;
          if (!b.dryRun && b.filename === "c.csv") {
            await new Promise((r) => setTimeout(r, 50)); // let React paint b's failure
            bWhenCImports = statusOf("b.csv").textContent ?? "";
          }
          if (b.dryRun && b.filename === "b.csv" && ++checksOfB > 1) return { status: 500, body: { error: "Server error" } };
          return asNew(body);
        },
      },
    }));
    await ready([["a.csv", "Alpha"], ["b.csv", "Alpha"], ["c.csv", "Beta"]]);
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    await waitFor(() => expect(statusOf("b.csv")).toHaveTextContent("Couldn't check"));
    expect(mock.imports(false).map((b) => b.filename)).toEqual(["a.csv", "c.csv"]);
    // The re-check's failure showed on the row while the run went on.
    expect(bWhenCImports).toContain("Couldn't check");
    expect(statusOf("a.csv")).toHaveTextContent("Imported 2");
    expect(statusOf("c.csv")).toHaveTextContent("Imported 2");
  });

  it("does not ask Gemini when the box is unticked", async () => {
    const mock = renderImport(api({
      sources: SOURCES, gemini: true,
      routes: { "POST /api/import": (body) => ({ body: { ...asNew(body).body as object, newMerchants: ["Corner Shop"] } }) },
    }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(screen.getByLabelText("Suggest categories for new merchants"));
    await userEvent.click(importButton());
    await screen.findByRole("region", { name: "Import result" });
    expect(mock.calls.filter((c) => c.path === "/api/merchants/suggest")).toHaveLength(0);
  });

  it("starts over", async () => {
    renderImport(api({ sources: SOURCES }));
    await ready([["a.csv", "Alpha"]]);
    await userEvent.click(importButton());
    await userEvent.click(await screen.findByRole("button", { name: "Start over" }));
    expect(screen.queryByLabelText("Status of a.csv")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Import result" })).not.toBeInTheDocument();
  });
});
