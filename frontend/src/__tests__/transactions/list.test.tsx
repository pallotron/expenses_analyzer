/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayList, dayLabel } from "../../transactions/DayList";
import { sortRows, TransactionTable } from "../../transactions/TransactionTable";
import type { TransactionRow } from "../../lib/types";

const row = (id: number, date: string, merchant: string, amountCents: number, type: "expense" | "income" = "expense"): TransactionRow => ({
  id, date, merchant, merchantRaw: merchant.toUpperCase(), amountCents, type, category: "Groceries", merchantCategory: "Groceries", categoryOverridden: false, budget: "essential", tags: "", source: "Card",
});
const rows = [row(3, "2026-09-29", "tesco", 5420), row(2, "2026-09-29", "Lidl", 3110), row(1, "2026-09-27", "Employer", 500000, "income")];

const sel = { selected: new Set<number>(), onToggle: vi.fn(), onOpen: vi.fn() };

describe("sortRows", () => {
  it("sorts text without regard to case, ties newest first", () => {
    expect(sortRows(rows, "merchant", "asc").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortRows(rows, "amount", "desc").map((r) => r.id)).toEqual([1, 3, 2]);
    expect(sortRows(rows, "source", "asc").map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("does not mutate its input", () => {
    const copy = [...rows];
    sortRows(rows, "merchant", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("dayLabel", () => {
  it("names the weekday and month without Intl", () => {
    expect(dayLabel("2026-09-29")).toBe("Tue 29 Sep");
    expect(dayLabel("2026-01-01")).toBe("Thu 1 Jan");
  });
});

describe("TransactionTable", () => {
  it("shows every column and flips the sort on the current header", () => {
    const onSort = vi.fn();
    render(<TransactionTable rows={rows} {...sel} onToggleShown={vi.fn()} sort="date" dir="desc" onSort={onSort} />);
    for (const h of ["Date", "Merchant", "Amount", "Source", "Category", "Budget", "Tags"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: /Type/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Date/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    expect(onSort).toHaveBeenLastCalledWith("date", "asc");
    fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    expect(onSort).toHaveBeenLastCalledWith("amount", "asc");
  });
});

describe("TransactionTable stripes", () => {
  it("alternates row backgrounds and strengthens hover over the stripe", () => {
    render(<TransactionTable rows={rows} {...sel} onToggleShown={vi.fn()} sort="date" dir="desc" onSort={vi.fn()} />);
    const body = screen.getAllByRole("row").slice(1);
    expect(body.length).toBeGreaterThan(0);
    for (const tr of body) {
      expect(tr.className).toContain("odd:bg-white");
      for (const c of ["even:bg-slate-100", "dark:even:bg-slate-900", "odd:hover:bg-slate-200", "even:hover:bg-slate-200", "dark:odd:hover:bg-slate-800", "dark:even:hover:bg-slate-800"]) {
        expect(tr.className.split(" ")).toContain(c);
      }
    }
  });
});

describe("DayList stripes", () => {
  it("uses the darker stripe colours", () => {
    render(<DayList rows={rows} {...sel} />);
    for (const li of screen.getAllByRole("listitem").filter((l) => l.className.includes("odd:bg-white"))) {
      expect(li.className.split(" ")).toContain("even:bg-slate-100");
      expect(li.className.split(" ")).toContain("dark:even:bg-slate-900");
    }
  });
});

describe("TransactionTable amounts", () => {
  it("signs and colours the amount by type", () => {
    render(<TransactionTable rows={rows} {...sel} onToggleShown={vi.fn()} sort="date" dir="desc" onSort={vi.fn()} />);
    const income = screen.getByText("+€5,000.00");
    expect(income.tagName).toBe("TD");
    expect(income).toHaveClass("text-income", "text-right", "whitespace-nowrap");
    const expense = screen.getByText("\u2212€54.20");
    expect(expense).toHaveClass("text-right", "whitespace-nowrap");
    expect(expense).not.toHaveClass("text-income");
  });
});

describe("DayList", () => {
  it("groups rows under their day", () => {
    render(<DayList rows={rows} {...sel} />);
    const days = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(["Tue 29 Sep", "Sun 27 Sep"]);
    const first = screen.getByRole("list", { name: "Tue 29 Sep" });
    expect(within(first).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("+€5,000.00")).toHaveClass("text-income");
    expect(screen.getByText("\u2212€54.20")).not.toHaveClass("text-income");
  });
});

describe("TransactionTable sticky header", () => {
  it("pins every header cell under the top bar and the frozen controls from md up", () => {
    render(<TransactionTable rows={rows} {...sel} onToggleShown={vi.fn()} sort="date" dir="desc" onSort={vi.fn()} />);
    const heads = screen.getAllByRole("columnheader");
    expect(heads).toHaveLength(8);
    for (const th of heads) {
      const c = th.className.split(" ");
      expect(c).toContain("md:sticky");
      expect(c).toContain("md:top-[calc(var(--topbar-h,0px)+var(--controls-h,0px))]");
      expect(c).toContain("md:z-10");
      expect(c).toContain("bg-white");
      expect(c).toContain("dark:bg-slate-950");
    }
  });
  it("does not clip the sticky header with a scroll wrapper at md", () => {
    const { container } = render(<TransactionTable rows={rows} {...sel} onToggleShown={vi.fn()} sort="date" dir="desc" onSort={vi.fn()} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("md:overflow-visible");
  });
});
