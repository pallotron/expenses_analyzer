/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashFlowTiles } from "../../summary/CashFlowTiles";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});

describe("CashFlowTiles", () => {
  it("shows income, expenses, net and the savings rate", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 6_140_000, expensesCents: 3_895_000 }} />);
    expect(screen.getByText("€61,400.00")).toBeInTheDocument();
    expect(screen.getByText("€38,950.00")).toBeInTheDocument();
    expect(screen.getByText("€22,450.00")).toBeInTheDocument();
    expect(screen.getByText("36.6%")).toBeInTheDocument();
  });

  it("shows a dash, not a number, for the savings rate with no income", () => {
    render(<CashFlowTiles cashFlow={{ incomeCents: 0, expensesCents: 5_000 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("-€50.00")).toBeInTheDocument();
  });
});
