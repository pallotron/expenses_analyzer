/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
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

describe("BreakdownList links", () => {
  it("links an item to its transactions when given an href", () => {
    render(<MemoryRouter><BreakdownList title="Cats" tone="expense" items={[{ label: "Groceries", amountCents: 100, href: "/transactions?category=%22Groceries%22" }]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Groceries" })).toHaveAttribute("href", "/transactions?category=%22Groceries%22");
  });

  it("links folded items once the smaller items are opened", async () => {
    render(<MemoryRouter><BreakdownList title="Cats" tone="expense" foldBelow={0.01} items={[
      { label: "Rent", amountCents: 100_000, href: "/t?c=Rent" },
      { label: "Stamps", amountCents: 100, href: "/t?c=Stamps" },
      { label: "Pens", amountCents: 100, href: "/t?c=Pens" },
    ]} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /smaller items/i }));
    expect(screen.getByRole("link", { name: "Stamps" })).toHaveAttribute("href", "/t?c=Stamps");
  });

  it("makes the whole linked row the target and highlights it on hover", () => {
    render(<MemoryRouter><BreakdownList title="Cats" tone="expense" items={[{ label: "Groceries", amountCents: 100, href: "/t" }]} /></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Groceries" });
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    expect(link.closest("li")).toHaveClass("relative", "hover:bg-slate-100");
  });

  it("leaves the label plain without an href", () => {
    render(<BreakdownList title="Cats" tone="expense" items={[{ label: "Groceries", amountCents: 100 }]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
