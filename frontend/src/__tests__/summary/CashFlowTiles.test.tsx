/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashFlowTiles } from "../../summary/CashFlowTiles";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("CashFlowTiles", () => {
  it("shows income, expenses, net and the savings rate", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 6_140_000, expensesCents: 3_895_000 }} monthAverage={null} />);
    expect(screen.getByText("€61,400.00")).toBeInTheDocument();
    expect(screen.getByText("€38,950.00")).toBeInTheDocument();
    expect(screen.getByText("€22,450.00")).toBeInTheDocument();
    expect(screen.getByText("36.6%")).toBeInTheDocument();
  });

  it("colours the savings rate like the net", () => {
    const { rerender } = render(<CashFlowTiles cashFlow={{ incomeCents: 10_000, expensesCents: 4_000 }} monthAverage={null} />);
    expect(screen.getByText("60.0%")).toHaveClass("text-income");
    rerender(<CashFlowTiles cashFlow={{ incomeCents: 10_000, expensesCents: 12_000 }} monthAverage={null} />);
    expect(screen.getByText("-20.0%")).toHaveClass("text-expense");
    rerender(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 12_000 }} monthAverage={null} />);
    expect(screen.getByText("—")).not.toHaveClass("text-income", "text-expense");
  });

  it("compares a month with its average, where up is bad for expenses and good for income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 500_000, expensesCents: 300_000 }}
      monthAverage={{ incomeCents: 400_000, expensesCents: 350_000, months: 6 }} />);
    const income = screen.getByText(/vs avg €4,000\.00/);
    expect(income).toHaveTextContent("▲");
    expect(income).toHaveClass("text-income");
    const expenses = screen.getByText(/vs avg €3,500\.00/);
    expect(expenses).toHaveTextContent("▼");
    expect(expenses).toHaveClass("text-income"); // spending less is good
  });

  it("colours spending above average as bad", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 300_000, expensesCents: 400_000 }}
      monthAverage={{ incomeCents: 400_000, expensesCents: 350_000, months: 6 }} />);
    expect(screen.getByText(/vs avg €3,500\.00/)).toHaveClass("text-expense");
    expect(screen.getByText(/vs avg €4,000\.00/)).toHaveClass("text-expense");
  });

  it("shows no comparison without an average", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 500_000, expensesCents: 300_000 }} monthAverage={null} />);
    expect(screen.queryByText(/vs avg/)).not.toBeInTheDocument();
  });

  it("shows a dash, not a number, for the savings rate with no income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 5_000 }} monthAverage={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("-€50.00")).toBeInTheDocument();
  });
});
