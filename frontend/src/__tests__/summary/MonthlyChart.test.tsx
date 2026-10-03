/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { MonthlyChart } from "../../summary/MonthlyChart";

// jsdom has no layout, so give the chart a fixed size instead of measuring.
vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: (p: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(p.children, { width: 600, height: 300 }),
}));

const totals = [1, 2, 3].map((month) => ({ month, incomeCents: 100_000 * month, expensesCents: 50_000 * month }));

let location = "";
function LocationProbe() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}

function renderChart() {
  location = "";
  const monthHref = (type: "income" | "expense" | null, m: number) => `/t?type=${type ?? "all"}&m=${m}`;
  const { container } = render(
    <MemoryRouter>
      <MonthlyChart totals={totals} lastMonth={3} monthHref={monthHref} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return container;
}

describe("MonthlyChart clicks", () => {
  it("opens a month's expenses from its expense bar", () => {
    const container = renderChart();
    const bars = container.querySelectorAll(".recharts-bar-rectangle");
    expect(bars.length).toBe(6); // income then expenses, three months each
    fireEvent.click(bars[4]);
    expect(location).toBe("/t?type=expense&m=2");
  });

  it("opens a month's income from its income bar", () => {
    const container = renderChart();
    fireEvent.click(container.querySelectorAll(".recharts-bar-rectangle")[0]);
    expect(location).toBe("/t?type=income&m=1");
  });

  it("shows a pointer over the chart", () => {
    expect(renderChart().querySelector(".recharts-wrapper")).toHaveStyle({ cursor: "pointer" });
  });

  it("is not clickable without monthHref", () => {
    const { container } = render(<MemoryRouter><MonthlyChart totals={totals} lastMonth={3} /></MemoryRouter>);
    expect(container.querySelector(".recharts-wrapper")).not.toHaveStyle({ cursor: "pointer" });
  });
});
