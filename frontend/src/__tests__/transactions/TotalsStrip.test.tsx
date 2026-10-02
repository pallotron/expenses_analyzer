/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TotalsStrip } from "../../transactions/TotalsStrip";

const totals = () => screen.getByRole("region", { name: "Totals" });

describe("TotalsStrip", () => {
  it("shows Income, Expenses and Net items with a positive net in the income colour", () => {
    render(<TotalsStrip count={2} incomeCents={500000} expensesCents={5420} />);
    const t = within(totals());
    expect(t.getByText("Income")).toBeInTheDocument();
    expect(t.getByText("Expenses")).toBeInTheDocument();
    expect(t.getByText("Net")).toBeInTheDocument();
    expect(t.getByText("€5,000.00")).toHaveClass("text-income");
    expect(t.getByText("€54.20")).toHaveClass("text-expense");
    expect(t.getByText("€4,945.80")).toHaveClass("text-income");
  });

  it("is one compact inline line: small labels and values, no boxes, count last", () => {
    render(<TotalsStrip count={195} incomeCents={500000} expensesCents={5420} />);
    const section = totals();
    expect(section.className).toContain("gap-x-4");
    expect(section.className).toContain("flex-wrap");
    expect(section.innerHTML).not.toContain("border");
    expect(within(section).getByText("Income")).toHaveClass("text-xs", "uppercase", "tracking-wide", "text-slate-500");
    expect(within(section).getByText("€5,000.00")).toHaveClass("text-sm", "font-semibold", "tabular-nums");
    const count = within(section).getByText("195 transactions");
    expect(count).toHaveClass("text-sm", "text-slate-500", "dark:text-slate-400");
    expect(section.lastElementChild).toBe(count);
  });

  it("prefixes a negative net with a minus sign and uses the expense colour", () => {
    render(<TotalsStrip count={3} incomeCents={100} expensesCents={5100} />);
    expect(within(totals()).getByText("−€50.00")).toHaveClass("text-expense");
  });

  it("shows only Expenses for type=expense", () => {
    render(<TotalsStrip count={3} incomeCents={100} expensesCents={5100} type="expense" />);
    const t = within(totals());
    expect(t.getByText("Expenses")).toBeInTheDocument();
    expect(t.queryByText("Income")).toBeNull();
    expect(t.queryByText("Net")).toBeNull();
  });

  it("shows only Income for type=income", () => {
    render(<TotalsStrip count={3} incomeCents={100} expensesCents={5100} type="income" />);
    const t = within(totals());
    expect(t.getByText("Income")).toBeInTheDocument();
    expect(t.queryByText("Expenses")).toBeNull();
    expect(t.queryByText("Net")).toBeNull();
  });

  it("says transaction for one and transactions otherwise", () => {
    const { rerender } = render(<TotalsStrip count={1} incomeCents={0} expensesCents={100} />);
    expect(within(totals()).getByText("1 transaction")).toBeInTheDocument();
    rerender(<TotalsStrip count={195} incomeCents={0} expensesCents={100} />);
    expect(within(totals()).getByText("195 transactions")).toBeInTheDocument();
  });
});
