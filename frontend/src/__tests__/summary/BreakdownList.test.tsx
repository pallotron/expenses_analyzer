/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BreakdownList } from "../../summary/BreakdownList";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});

const bar = (name: string) => within(screen.getByText(name).closest("li")!).queryByTestId("bar");

describe("BreakdownList bars", () => {
  it("colours a bar by what the spending is", () => {
    render(<BreakdownList title="Expense categories" tone="expense" items={[
      { label: "Rent", amountCents: 100_000, kind: "essential" },
      { label: "Dining", amountCents: 50_000, kind: "discretionary" },
      { label: "Misc", amountCents: 10_000 },
    ]} />);
    expect(bar("Rent")).toHaveClass("bg-essential");
    expect(bar("Dining")).toHaveClass("bg-discretionary");
    expect(bar("Misc")).toHaveClass("bg-expense");
  });

  it("colours income bars as income, and draws none under one percent of the total", () => {
    render(<BreakdownList title="Income categories" tone="income" items={[
      { label: "Salary", amountCents: 99_500, kind: "income" },
      { label: "Interest", amountCents: 500, kind: "income" },
    ]} />);
    expect(bar("Salary")).toHaveClass("bg-income");
    expect(bar("Interest")).toBeNull();
    expect(screen.getByText("€5.00")).toBeInTheDocument(); // the row and its amount stay
  });
});

describe("BreakdownList layout", () => {
  it("folds items under the threshold into one row that opens on request", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<BreakdownList title="Income categories" tone="income" foldBelow={0.01} items={[
      { label: "Salary", amountCents: 99_000, kind: "income" },
      { label: "Clothing", amountCents: 300, kind: "income" },
      { label: "Shopping", amountCents: 100, kind: "income" },
    ]} />);
    expect(screen.queryByText("Clothing")).not.toBeInTheDocument();
    const fold = screen.getByRole("button", { name: /Smaller items \(2\)/ });
    expect(fold).toHaveTextContent("€4.00");
    await userEvent.click(fold);
    expect(screen.getByText("Clothing")).toBeInTheDocument();
  });

  it("does not fold a single small item", () => {
    render(<BreakdownList title="Income categories" tone="income" foldBelow={0.01} items={[
      { label: "Salary", amountCents: 99_000, kind: "income" },
      { label: "Interest", amountCents: 100, kind: "income" },
    ]} />);
    expect(screen.getByText("Interest")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /smaller items/i })).not.toBeInTheDocument();
  });

  it("spells out payment counts under the name", () => {
    render(<BreakdownList title="Top expense merchants" tone="expense" items={[
      { label: "Tesco", sublabel: "Groceries", amountCents: 5_000, count: 71 },
      { label: "Florist", sublabel: "Gifts", amountCents: 1_000, count: 1 },
    ]} />);
    expect(screen.getByText("Groceries · 71 payments")).toBeInTheDocument();
    expect(screen.getByText("Gifts · 1 payment")).toBeInTheDocument();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it("leaves the total to the tiles", () => {
    render(<BreakdownList title="Expense categories" tone="expense" items={[{ label: "Rent", amountCents: 100_000 }]} />);
    expect(screen.getByRole("heading", { name: "Expense categories" })).toBeInTheDocument();
  });
});
