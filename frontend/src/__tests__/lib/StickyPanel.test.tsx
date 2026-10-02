/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
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

  it("marks itself stuck once the sentinel leaves the view", async () => {
    let callback: (e: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: typeof callback) { callback = cb; }
      observe() {}
      disconnect() {}
    });
    render(<StickyPanel label="Controls"><p>x</p></StickyPanel>);
    const { act } = await import("@testing-library/react");
    act(() => callback([{ isIntersecting: false }]));
    expect(screen.getByRole("region", { name: "Controls" })).toHaveAttribute("data-stuck", "true");
  });
});
