/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "../../lib/Sheet";

describe("Sheet", () => {
  it("shows its content as a named dialog only while open", () => {
    const { rerender } = render(<Sheet title="Edit transaction" open={false} onClose={() => {}}><p>Body</p></Sheet>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    rerender(<Sheet title="Edit transaction" open onClose={() => {}}><p>Body</p></Sheet>);
    expect(screen.getByRole("dialog", { name: "Edit transaction" })).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("closes on Escape and on the backdrop, but not while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sheet title="T" open busy onClose={onClose}><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "T" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Sheet title="T" open onClose={onClose}><p>Body</p></Sheet>);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has a Close button", () => {
    const onClose = vi.fn();
    render(<Sheet title="T" open onClose={onClose}><p>Body</p></Sheet>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("prevents the native cancel, busy or not", () => {
    const { rerender } = render(<Sheet title="T" open busy onClose={() => {}}><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "T" });
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    rerender(<Sheet title="T" open onClose={() => {}}><p>Body</p></Sheet>);
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
  });

  it("reopens when closed natively while busy, without telling the parent", () => {
    const onClose = vi.fn();
    render(<Sheet title="T" open busy onClose={onClose}><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "T" }) as HTMLDialogElement;
    act(() => dialog.close());
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tells the parent about a native close when not busy, but not about its own", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sheet title="T" open onClose={onClose}><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "T" }) as HTMLDialogElement;
    act(() => dialog.close());
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Sheet title="T" open={false} onClose={onClose}><p>Body</p></Sheet>);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
