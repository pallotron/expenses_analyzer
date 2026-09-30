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
