/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TotalsStrip } from "../../transactions/TotalsStrip";

const totals = () => screen.getByRole("region", { name: "Totals" });

describe("TotalsStrip", () => {
  it("shows Income, Expenses and Net tiles with a positive net in the income colour", () => {
    render(<TotalsStrip count={2} incomeCents={500000} expensesCents={5420} />);
    const t = within(totals());
    expect(t.getByText("Income")).toBeInTheDocument();
    expect(t.getByText("Expenses")).toBeInTheDocument();
    expect(t.getByText("Net")).toBeInTheDocument();
    expect(t.getByText("€5,000.00")).toHaveClass("text-income");
    expect(t.getByText("€54.20")).toHaveClass("text-expense");
    expect(t.getByText("€4,945.80")).toHaveClass("text-income");
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
