/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PayslipsResponse } from "../../lib/types";
import { PayslipsPage } from "../../payslips/PayslipsPage";
import { PayslipDecryptError, type LineExtractor } from "../../payslips/payslipFile";

const LINES = ["Salary 5000.00", "Pension 500.00 500.00 500.00 500.00", "PAYE 1000.00 1000.00", "AVC 100.00 100.00"];
const pdf = (name: string) => new File([new Uint8Array([1])], name, { type: "application/pdf" });

type Call = { path: string; method: string; body: unknown };

function api(opts: { importStatus?: number } = {}) {
  const state: PayslipsResponse = {
    people: [
      { id: 1, name: "A", months: [{
        month: "2025-12", grossCents: 1, netCents: 2, taxTotalCents: 3, pensionEeCents: 4, avcCents: 5,
        pensionErCents: 6, bonusCents: 0, onCallCents: 0, netReconciled: true, ytdReconciled: true, runs: [] }] },
      { id: 2, name: "B", months: [{
        month: "2026-01", grossCents: 500000, netCents: 380000, taxTotalCents: 100000, pensionEeCents: 50000,
        avcCents: 10000, pensionErCents: 50000, bonusCents: 0, onCallCents: 0, netReconciled: true, ytdReconciled: false,
        runs: [{ sourceFile: "2026-01 pay.pdf", grossCents: 500000, netCents: 380000, pensionEeCents: 50000,
          avcCents: 10000, pensionErCents: 50000, netReconciled: true }] }] },
    ],
  };
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/me") return json({ id: 1, email: "a@example.com", displayName: "A" });
    if (url.pathname === "/api/payslips") return json(state);
    if (url.pathname === "/api/payslips/import") {
      if (opts.importStatus) return json({ error: "Nope" }, opts.importStatus);
      // 2026-03 was only re-checked, not imported.
      return json({ months: ["2026-01", "2026-02", "2026-03"], imported: ["2026-01", "2026-02"], replaced: 0, ytdMismatches: ["2026-02"] });
    }
    if (url.pathname === "/api/payslips/remove") return json({ months: ["2026-01"] });
    return json({});
  };
  return { fetch, calls, posts: (path: string) => calls.filter((c) => c.method === "POST" && c.path === path).map((c) => c.body) };
}

function renderPage(mock = api(), extractor: LineExtractor = async () => LINES) {
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><PayslipsPage extractor={extractor} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return mock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

const drop = async (...files: File[]) => userEvent.upload(await screen.findByLabelText("Payslip PDFs"), files);
const line = (name: string) => screen.getByText(name).closest("li")!;

describe("the Payslips page", () => {
  it("starts on the signed-in person and lists their saved months", async () => {
    renderPage();
    expect(await screen.findByRole("combobox", { name: "Person" })).toHaveValue("1");
    expect(await screen.findByText("2025-12")).toBeInTheDocument();
    expect(screen.getByText("1 month · 1 from the TUI")).toBeInTheDocument();
  });

  it("previews each dropped file and imports the ready ones for the chosen person", async () => {
    const mock = renderPage();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Person" }), "2");
    await drop(pdf("2026-02 pay.pdf"), pdf("2026-01 pay.pdf"), pdf("notes.pdf"), pdf("2026-03 draft.pdf"));
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("New"));
    expect(line("2026-01 pay.pdf")).toHaveTextContent("Replaces the saved copy");
    expect(line("notes.pdf")).toHaveTextContent("No month in the file name");
    expect(line("2026-03 draft.pdf")).toHaveTextContent('Left out (name contains "draft")');

    await userEvent.click(screen.getByRole("button", { name: "Import 2 files" }));
    await waitFor(() => expect(mock.posts("/api/payslips/import")).toHaveLength(1));
    const body = mock.posts("/api/payslips/import")[0] as { userId: number; runs: { sourceFile: string; month: string; salaryCents: number }[] };
    expect(body.userId).toBe(2);
    expect(body.runs.map((r) => [r.sourceFile, r.month, r.salaryCents])).toEqual([
      ["2026-02 pay.pdf", "2026-02", 500000], ["2026-01 pay.pdf", "2026-01", 500000],
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 2026-01, 2026-02");
    expect(screen.getByRole("status")).not.toHaveTextContent("2026-03");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02's year-to-date pension does not add up");
    expect(screen.queryByText("2026-02 pay.pdf")).toBeNull();
  });

  it("includes an ignored file when asked", async () => {
    const mock = renderPage();
    await drop(pdf("2026-03 draft.pdf"));
    await waitFor(() => expect(line("2026-03 draft.pdf")).toHaveTextContent("Left out"));
    await userEvent.click(within(line("2026-03 draft.pdf")).getByRole("button", { name: "Use anyway" }));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 file" }));
    await waitFor(() => expect(mock.posts("/api/payslips/import")).toHaveLength(1));
  });

  it("asks for a password, remembers it, and re-reads the file", async () => {
    const locked: LineExtractor = async (_d, pw) => {
      if (pw === "pw") return LINES;
      throw new PayslipDecryptError("locked");
    };
    renderPage(api(), locked);
    await drop(pdf("2026-02 pay.pdf"));
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("Needs password"));
    await userEvent.type(screen.getByLabelText("PDF password"), "pw");
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("New"));
    expect(localStorage.getItem("payslip-password:1")).toBe("pw");
    await userEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(screen.getByLabelText("PDF password")).toHaveValue("");
    expect(localStorage.getItem("payslip-password:1")).toBeNull();
  });

  it("keeps the files and offers a retry when the import fails", async () => {
    renderPage(api({ importStatus: 500 }));
    await drop(pdf("2026-02 pay.pdf"));
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("New"));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nope");
    expect(screen.getByText("2026-02 pay.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("removes a saved file after confirming", async () => {
    const mock = renderPage();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Person" }), "2");
    await userEvent.click(await screen.findByRole("button", { name: "Files for 2026-01" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove 2026-01 pay.pdf" }));
    expect(mock.posts("/api/payslips/remove")).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(mock.posts("/api/payslips/remove")).toEqual([{ userId: 2, sourceFiles: ["2026-01 pay.pdf"] }]));
  });

  it("shows each month's checks", async () => {
    renderPage();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Person" }), "2");
    const row = (await screen.findByText("2026-01")).closest("tr")!;
    expect(within(row).getByTitle("Year-to-date pension does not add up")).toBeInTheDocument();
    // Not only on hover: screen readers get the same words.
    expect(within(row).getByText("Year-to-date pension does not add up")).toBeInTheDocument();
    expect(within(row).getByText("Net adds up")).toBeInTheDocument();
    expect(within(row).getByText("⚠")).toHaveAttribute("aria-hidden", "true");
  });

  it("warns that a file replaces a month the TUI saved", async () => {
    renderPage();
    await drop(pdf("2025-12 pay.pdf"));
    await waitFor(() => expect(line("2025-12 pay.pdf")).toHaveTextContent("Replaces the TUI's 2025-12"));
    expect(within(line("2025-12 pay.pdf")).getByText("Replaces the TUI's 2025-12")).toHaveClass("text-amber-600");
  });

  it("hides the last import's result when switching person", async () => {
    renderPage();
    await drop(pdf("2026-02 pay.pdf"));
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("New"));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 file" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person" }), "2");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists the PDFs inside a dropped folder", async () => {
    renderPage();
    const fileEntry = (file: File) => ({ isFile: true, isDirectory: false, name: file.name, file: (ok: (f: File) => void) => ok(file) });
    const folder = {
      isFile: false, isDirectory: true, name: "payslips",
      createReader: () => {
        let done = false;
        return { readEntries: (ok: (b: unknown[]) => void) => {
          ok(done ? [] : [fileEntry(pdf("2026-02 pay.pdf")), fileEntry(new File(["x"], "notes.txt"))]);
          done = true;
        } };
      },
    };
    const zone = (await screen.findByLabelText("Payslip PDFs")).closest("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { items: [{ kind: "file", webkitGetAsEntry: () => folder }], files: [new File([], "payslips")] } });
    await waitFor(() => expect(line("2026-02 pay.pdf")).toHaveTextContent("New"));
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(screen.queryByText("No PDFs in what was dropped")).toBeNull();
  });

  it("says so when what was dropped holds no PDFs", async () => {
    renderPage();
    const zone = (await screen.findByLabelText("Payslip PDFs")).closest("[data-dropzone]")!;
    fireEvent.drop(zone, { dataTransfer: { items: [], files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText("No PDFs in what was dropped")).toBeInTheDocument();
    await drop(pdf("2026-02 pay.pdf"));
    await waitFor(() => expect(screen.queryByText("No PDFs in what was dropped")).toBeNull());
  });
});
