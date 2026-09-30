/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Grid } from "../../lib/types";
import { MonthlyGrid } from "../../summary/MonthlyGrid";

const months = (xs: number[], hot = -1) => xs.map((amountCents, i) => ({ amountCents, anomaly: i === hot }));
const grid: Grid = {
  rows: [
    { category: "Groceries", totalCents: 30_000, months: months([10_000, 0, 20_000, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2) },
    { category: "Travel", totalCents: 5_000, months: months([0, 0, 0, 0, 5_000, 0, 0, 0, 0, 0, 0, 0]) },
  ],
  total: { category: "Total", totalCents: 35_000, months: months([10_000, 0, 20_000, 0, 5_000, 0, 0, 0, 0, 0, 0, 0]) },
};

const screenIs = (desktop: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} }));
afterEach(() => vi.unstubAllGlobals());

describe("MonthlyGrid on desktop", () => {
  it("is a table with totals, averages over active months, and a total row averaged over twelve", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    const table = screen.getByRole("table");
    const groceries = within(table).getByRole("row", { name: /Groceries/ });
    expect(groceries).toHaveTextContent("€300.00"); // total
    expect(groceries).toHaveTextContent("€150.00"); // 30,000 / 2 active months
    const total = within(table).getByRole("row", { name: /^Total/ }); // the header row also says "Total"
    expect(total).toHaveTextContent("€29.17"); // 35,000 / 12
  });

  it("marks an anomaly so it is visible without colour", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    expect(screen.getByTitle(/unusually high/i)).toHaveTextContent("€200.00");
  });
});

describe("MonthlyGrid on a phone", () => {
  it("shows one row per category and expands to the monthly numbers on tap", async () => {
    screenIs(false);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: /Groceries/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });
});

describe("MonthlyGrid with nothing in it", () => {
  it("says so rather than drawing an empty table", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly income" grid={{ rows: [], total: grid.total }} tone="income" />);
    expect(screen.getByText(/nothing this year/i)).toBeInTheDocument();
  });
});
