/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { PayslipMonthRow, PayslipPerson } from "../../lib/types";
import { SavedPayslips } from "../../payslips/SavedPayslips";

const month = (m: string, over: Partial<PayslipMonthRow> = {}): PayslipMonthRow => ({
  month: m, grossCents: 500000, netCents: 300000, taxTotalCents: 100000, pensionEeCents: 50000, avcCents: 10000,
  pensionErCents: 50000, bonusCents: 0, onCallCents: 0, netReconciled: true, ytdReconciled: true, runs: [], ...over,
});

function renderPerson(months: PayslipMonthRow[]) {
  const person: PayslipPerson = { id: 1, name: "A", months };
  render(<QueryClientProvider client={new QueryClient()}><SavedPayslips person={person} /></QueryClientProvider>);
}

afterEach(cleanup);

describe("SavedPayslips", () => {
  it("groups months by year with totals, only the newest year open", async () => {
    renderPerson([month("2026-02"), month("2026-01"), month("2025-12", { ytdReconciled: false }), month("2025-11")]);
    const y2026 = screen.getByRole("button", { name: "Payslips for 2026" });
    const y2025 = screen.getByRole("button", { name: "Payslips for 2025" });
    expect(y2026).toHaveAttribute("aria-expanded", "true");
    expect(y2025).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("2026-02")).toBeInTheDocument();
    expect(screen.queryByText("2025-12")).toBeNull();

    const header2025 = y2025.closest("tr")!;
    expect(header2025).toHaveTextContent("€10,000.00");
    expect(header2025).toHaveTextContent("€1,200.00 / €1,000.00");
    expect(within(header2025).getByText("A month in this year does not add up")).toBeInTheDocument();
    expect(header2025).toHaveTextContent("2 months · 2 from the TUI");

    await userEvent.click(y2025);
    expect(screen.getByText("2025-12")).toBeInTheDocument();
    await userEvent.click(y2026);
    expect(screen.queryByText("2026-02")).toBeNull();
  });

  it("says so when nothing is saved", () => {
    renderPerson([]);
    expect(screen.getByText("No payslips saved for A yet.")).toBeInTheDocument();
  });
});
