/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    const table = screen.getByRole("table");
    const groceries = within(table).getByRole("row", { name: /Groceries/ });
    expect(groceries).toHaveTextContent("€300.00"); // total
    expect(groceries).toHaveTextContent("€150.00"); // 30,000 / 2 active months
    const total = within(table).getByRole("row", { name: /^Total/ }); // the header row also says "Total"
    expect(total).toHaveTextContent("€29.17"); // 35,000 / 12
  });

  it("puts Total and Average right after the category, before the months", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    const headers = within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(0, 5)).toEqual(["Category", "Total", "Average", "Trend", "Jan"]);
    expect(headers).toHaveLength(16);
  });

  it("freezes Category, Total, Average and Trend while the months scroll", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    const table = screen.getByRole("table");
    const [category, total, average, trend, jan] = within(table).getAllByRole("columnheader");
    expect([category, total, average, trend].map((h) => h.style.left)).toEqual(["0rem", "9rem", "16rem", "23rem"]);
    for (const h of [category, total, average, trend]) expect(h).toHaveClass("sticky");
    expect(jan).not.toHaveClass("sticky");
    const cells = within(within(table).getByRole("row", { name: /Groceries/ })).getAllByRole("cell");
    expect(cells.slice(0, 3).every((c) => c.classList.contains("sticky"))).toBe(true);
    expect(cells[3]).not.toHaveClass("sticky");
  });

  it("stops at the last month with data", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={3} />);
    const table = screen.getByRole("table");
    expect(within(table).queryByRole("columnheader", { name: "Apr" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Mar" })).toBeInTheDocument();
    // Category, Total, Average, Trend and three months
    expect(within(within(table).getByRole("row", { name: /Groceries/ })).getAllByRole("cell")).toHaveLength(6);
    expect(within(table).getByRole("row", { name: /Groceries/ })).toHaveTextContent("€150.00"); // average unchanged
  });

  it("marks an anomaly so it is visible without colour", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    expect(screen.getByTitle(/unusually high/i)).toHaveTextContent("€200.00");
  });
});

describe("MonthlyGrid trend arrows", () => {
  it("marks each month with spend against the month before, as the TUI does", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    const table = screen.getByRole("table");
    const groceries = within(table).getByRole("row", { name: /Groceries/ });
    // Jan has no month before it; Mar went up from nothing in Feb.
    expect(within(groceries).getAllByLabelText(/month before/)).toHaveLength(1);
    expect(within(groceries).getByLabelText("up on the month before")).toHaveTextContent("↑");
    const total = within(table).getByRole("row", { name: /^Total/ });
    expect(within(total).queryAllByLabelText(/month before/)).toHaveLength(0);
  });

  it("draws no arrows in the income grid", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly income" grid={grid} tone="income" lastMonth={12} />);
    expect(screen.queryAllByLabelText(/month before/)).toHaveLength(0);
  });

  it("shows the arrows in a phone row's months", async () => {
    screenIs(false);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    await userEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    expect(screen.getByLabelText("up on the month before")).toBeInTheDocument();
  });
});

describe("MonthlyGrid scrolling sideways", () => {
  // jsdom lays nothing out: give the scroll box a size, and a working scrollLeft.
  function layout(scrollWidth: number, clientWidth: number) {
    let left = 0;
    const box = HTMLDivElement.prototype;
    const props = {
      scrollWidth: { configurable: true, get: () => scrollWidth },
      clientWidth: { configurable: true, get: () => clientWidth },
      scrollLeft: { configurable: true, get: () => left, set: (v: number) => { left = Math.max(0, Math.min(v, scrollWidth - clientWidth)); } },
    };
    Object.defineProperties(box, props);
    box.scrollBy = function (this: HTMLElement, opts?: ScrollToOptions | number) {
      this.scrollLeft += typeof opts === "number" ? opts : opts?.left ?? 0;
      this.dispatchEvent(new Event("scroll"));
    } as typeof box.scrollBy;
    return () => {
      for (const k of Object.keys(props)) delete (box as unknown as Record<string, unknown>)[k];
      delete (box as unknown as Record<string, unknown>).scrollBy;
    };
  }

  it("opens on the latest months, with a fade and a button back to earlier ones", () => {
    screenIs(true);
    const undo = layout(1200, 800);
    try {
      render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
      expect(screen.getByTestId("fade-left")).toBeInTheDocument();
      expect(screen.queryByTestId("fade-right")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Later months" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Earlier months" }));
      expect(screen.getByTestId("fade-right")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Later months" })).toBeEnabled();
    } finally {
      undo();
    }
  });

  it("shows no buttons or fades when everything fits", () => {
    screenIs(true);
    const undo = layout(800, 800);
    try {
      render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
      expect(screen.queryByRole("button", { name: /months/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId(/fade/)).not.toBeInTheDocument();
    } finally {
      undo();
    }
  });
});

describe("MonthlyGrid on a phone", () => {
  it("shows one row per category and expands to the monthly numbers on tap", async () => {
    screenIs(false);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={12} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const row = screen.getByRole("button", { name: /Groceries/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Mar")).toBeInTheDocument();
  });

  it("expands only to the last month with data", async () => {
    screenIs(false);
    render(<MonthlyGrid title="Monthly expenses" grid={grid} tone="expense" lastMonth={3} />);
    await userEvent.click(screen.getByRole("button", { name: /Groceries/ }));
    expect(screen.getByText("Mar")).toBeInTheDocument();
    expect(screen.queryByText("Apr")).not.toBeInTheDocument();
  });
});

describe("MonthlyGrid with nothing in it", () => {
  it("says so rather than drawing an empty table", () => {
    screenIs(true);
    render(<MonthlyGrid title="Monthly income" grid={{ rows: [], total: grid.total }} tone="income" lastMonth={12} />);
    expect(screen.getByText(/nothing this year/i)).toBeInTheDocument();
  });
});
