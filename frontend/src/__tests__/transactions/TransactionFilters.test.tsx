// frontend/src/__tests__/transactions/TransactionFilters.test.tsx
/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEBOUNCE_MS, TransactionFilters } from "../../transactions/TransactionFilters";
import { parseTxParams, type TxParams } from "../../transactions/params";

const lookups = { categories: ["Groceries", "Rent"], tags: ["gift"], sources: ["Bank A", "Card"] };
const params = (qs: string) => parseTxParams(new URLSearchParams(qs));

function setup(p: TxParams, desktop = true) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  const utils = render(<TransactionFilters params={p} lookups={lookups} onChange={onChange} onClear={onClear} desktop={desktop} />);
  return { onChange, onClear, ...utils };
}

afterEach(() => vi.useRealTimers());

describe("TransactionFilters", () => {
  it("applies typed text once, after the pause", () => {
    vi.useFakeTimers();
    const { onChange } = setup(params(""));
    const box = screen.getByLabelText("Merchant");
    fireEvent.change(box, { target: { value: "te" } });
    fireEvent.change(box, { target: { value: "tes" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ merchant: "tes" });
  });

  it("clears a filter when its box is emptied", () => {
    vi.useFakeTimers();
    const { onChange } = setup(params("merchant=tes"));
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "" } });
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledWith({ merchant: undefined });
  });

  it("follows a URL change made elsewhere", () => {
    const { rerender, onChange, onClear } = setup(params("merchant=tes"));
    rerender(<TransactionFilters params={params("merchant=lidl")} lookups={lookups} onChange={onChange} onClear={onClear} desktop />);
    expect(screen.getByLabelText("Merchant")).toHaveValue("lidl");
  });

  it("sets type and budget from the button groups", () => {
    const { onChange } = setup(params(""));
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    expect(onChange).toHaveBeenCalledWith({ type: "income" });
    fireEvent.click(screen.getByRole("button", { name: "Essential" }));
    expect(onChange).toHaveBeenCalledWith({ budget: "essential" });
  });

  it("offers to stop excluding hidden tags only when they are excluded", () => {
    setup(params(""));
    expect(screen.queryByRole("button", { name: /hidden tags excluded/i })).not.toBeInTheDocument();
    const { onChange } = setup(params("excludeHidden=1"));
    fireEvent.click(screen.getByRole("button", { name: /hidden tags excluded/i }));
    expect(onChange).toHaveBeenCalledWith({ excludeHidden: false });
  });

  it("unticking a source narrows to the rest; ticking all goes back to every source", () => {
    const { onChange, rerender, onClear } = setup(params(""));
    fireEvent.click(screen.getByRole("checkbox", { name: "Card" }));
    expect(onChange).toHaveBeenLastCalledWith({ sources: ["Bank A"] });
    rerender(<TransactionFilters params={params("sources=Bank%20A")} lookups={lookups} onChange={onChange} onClear={onClear} desktop />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Card" }));
    expect(onChange).toHaveBeenLastCalledWith({ sources: undefined });
  });

  it("on a phone, counts active filters and removes one from its chip", () => {
    const { onChange } = setup(params('from=2026-09-01&to=2026-09-30&category="Groceries"&sources=Card'), false);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Merchant")).not.toBeInTheDocument(); // sheet closed
    fireEvent.click(screen.getByRole("button", { name: 'Remove Category: "Groceries"' }));
    expect(onChange).toHaveBeenCalledWith({ category: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }));
    expect(screen.getByLabelText("Merchant")).toBeInTheDocument();
  });

  it("clears everything", () => {
    const { onClear } = setup(params("merchant=x"));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("reports a pending edit through the newest onChange", () => {
    vi.useFakeTimers();
    const { onChange: oldChange, onClear, rerender } = setup(params(""));
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "tes" } });
    const newChange = vi.fn();
    rerender(<TransactionFilters params={params("type=income")} lookups={lookups} onChange={newChange} onClear={onClear} desktop />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(newChange).toHaveBeenCalledWith({ merchant: "tes" });
    expect(oldChange).not.toHaveBeenCalled();
  });

  it("keeps a pending edit when unmounted before the pause ends", () => {
    vi.useFakeTimers();
    const { onChange, unmount } = setup(params(""));
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "tes" } });
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ merchant: "tes" });
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("drops a pending edit when the URL changes elsewhere", () => {
    vi.useFakeTimers();
    const { onChange, onClear, rerender, unmount } = setup(params(""));
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "tes" } });
    rerender(<TransactionFilters params={params("merchant=lidl")} lookups={lookups} onChange={onChange} onClear={onClear} desktop />);
    unmount();
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows compact amount min and max inputs next to the type and budget groups", () => {
    setup(params(""));
    const min = screen.getByLabelText("Amount min");
    expect(screen.getByLabelText("Amount max")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Amount/ })).not.toBeInTheDocument();
    expect(min.closest("div")?.parentElement).toBe(screen.getByRole("group", { name: "Type" }).parentElement);
  });

  it("keeps the other desktop filters visible", () => {
    setup(params("min=10"));
    expect(screen.getByLabelText("Amount min")).toHaveValue("10");
    for (const l of ["From", "To", "Merchant", "Category", "Tags"]) expect(screen.getByLabelText(l)).toBeInTheDocument();
  });
});
