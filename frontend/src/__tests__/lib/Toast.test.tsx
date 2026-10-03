/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, Toast } from "../../lib/Toast";

afterEach(() => vi.useRealTimers());

describe("Toast", () => {
  it("announces the message, runs its action, and goes away after a while", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast toast={{ id: 1, message: "3 deleted", action: { label: "Undo", run } }} onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 deleted");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders an empty live region when there is nothing to say", () => {
    render(<Toast toast={null} onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
