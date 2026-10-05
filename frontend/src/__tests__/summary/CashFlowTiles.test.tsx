/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashFlowTiles } from "../../summary/CashFlowTiles";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("CashFlowTiles", () => {
  it("shows income, expenses, net and the savings rate", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 6_140_000, expensesCents: 3_895_000 }} monthAverage={null} pension={null} />);
    expect(screen.getByText("€61,400.00")).toBeInTheDocument();
    expect(screen.getByText("€38,950.00")).toBeInTheDocument();
    expect(screen.getByText("€22,450.00")).toBeInTheDocument();
    expect(screen.getByText("36.6%")).toBeInTheDocument();
  });

  it("colours the savings rate like the net", () => {
    const { rerender } = render(<CashFlowTiles cashFlow={{ incomeCents: 10_000, expensesCents: 4_000 }} monthAverage={null} pension={null} />);
    expect(screen.getByText("60.0%")).toHaveClass("text-income");
    rerender(<CashFlowTiles cashFlow={{ incomeCents: 10_000, expensesCents: 12_000 }} monthAverage={null} pension={null} />);
    expect(screen.getByText("-20.0%")).toHaveClass("text-expense");
    rerender(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 12_000 }} monthAverage={null} pension={null} />);
    expect(screen.getByText("—")).not.toHaveClass("text-income", "text-expense");
  });

  it("compares a month with its average, where up is bad for expenses and good for income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 500_000, expensesCents: 300_000 }}
      monthAverage={{ incomeCents: 400_000, expensesCents: 350_000, months: 6 }} pension={null} />);
    const income = screen.getByText(/vs avg €4,000\.00/);
    expect(income).toHaveTextContent("▲");
    expect(income).toHaveClass("text-income");
    const expenses = screen.getByText(/vs avg €3,500\.00/);
    expect(expenses).toHaveTextContent("▼");
    expect(expenses).toHaveClass("text-income"); // spending less is good
  });

  it("colours spending above average as bad", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 300_000, expensesCents: 400_000 }}
      monthAverage={{ incomeCents: 400_000, expensesCents: 350_000, months: 6 }} pension={null} />);
    expect(screen.getByText(/vs avg €3,500\.00/)).toHaveClass("text-expense");
    expect(screen.getByText(/vs avg €4,000\.00/)).toHaveClass("text-expense");
  });

  it("shows no comparison without an average", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 500_000, expensesCents: 300_000 }} monthAverage={null} pension={null} />);
    expect(screen.queryByText(/vs avg/)).not.toBeInTheDocument();
  });

  it("shows a dash, not a number, for the savings rate with no income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 5_000 }} monthAverage={null} pension={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("-€50.00")).toBeInTheDocument();
  });

  it("shows the savings rate with pension under the plain one", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 100000, expensesCents: 60000 }} monthAverage={null}
      pension={{ pensionCents: 10000, savedCents: 50000, incomeCents: 110000, rate: 45.4545, months: [1, 2, 3],
        coverageLabel: "Jan–Mar", reconciled: true, people: ["A", "B"] }} />);
    const line = screen.getByText("45.5% with pension · Jan–Mar");
    expect(line).toHaveAttribute("title", expect.stringContaining("A and B"));
  });

  it("warns when a month's year-to-date pension does not add up", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 100000, expensesCents: 60000 }} monthAverage={null}
      pension={{ pensionCents: 10000, savedCents: 50000, incomeCents: 110000, rate: 45.4545, months: [1],
        coverageLabel: "Jan", reconciled: false, people: ["A"] }} />);
    expect(screen.getByText("45.5% with pension · Jan ⚠")).toHaveAttribute("title", expect.stringContaining("Payslips page"));
  });

  it("shows no pension line without payslips", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 100000, expensesCents: 60000 }} monthAverage={null} pension={null} />);
    expect(screen.queryByText(/with pension/)).toBeNull();
  });
});
