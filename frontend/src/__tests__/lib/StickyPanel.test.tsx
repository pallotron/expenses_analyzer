/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StickyPanel } from "../../lib/StickyPanel";

afterEach(() => vi.unstubAllGlobals());

describe("StickyPanel", () => {
  it("renders its children inside a labelled region that sticks from md up", () => {
    render(<StickyPanel label="Controls"><button type="button">Go</button></StickyPanel>);
    const region = screen.getByRole("region", { name: "Controls" });
    expect(region).toContainElement(screen.getByRole("button", { name: "Go" }));
    expect(region.className).toContain("md:sticky");
  });

  it("does not crash without IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    expect(screen.getByRole("region", { name: "Controls" })).toHaveAttribute("data-stuck", "false");
  });

  it("marks itself stuck once the sentinel leaves the view", () => {
    let callback: (e: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: typeof callback) { callback = cb; }
      observe() {}
      disconnect() {}
    });
    render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    act(() => callback([{ isIntersecting: false }]));
    expect(screen.getByRole("region", { name: "Controls" })).toHaveAttribute("data-stuck", "true");
  });

  it("offsets the sentinel by the top bar height in CSS and observes with no root margin", () => {
    const seen: { options?: IntersectionObserverInit }[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(_cb: unknown, options?: IntersectionObserverInit) { seen.push({ options }); }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    expect(seen[0].options?.rootMargin).toBeUndefined();
    const sentinel = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(sentinel.style.marginTop).toContain("--topbar-h");
  });

  it("publishes the panel height as --controls-h and removes it on unmount", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      cb: (e: unknown[]) => void;
      constructor(cb: (e: unknown[]) => void) { this.cb = cb; }
      observe() { this.cb([{ borderBoxSize: [{ blockSize: 212 }] }]); }
      disconnect = disconnect;
    });
    const { unmount } = render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    expect(document.documentElement.style.getPropertyValue("--controls-h")).toBe("212px");
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--controls-h")).toBe("");
  });

  it("does not crash without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    expect(screen.getByRole("region", { name: "Controls" })).toBeInTheDocument();
  });
});
