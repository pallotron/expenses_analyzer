/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chevron } from "../../lib/Chevron";

describe("Chevron", () => {
  it("renders an aria-hidden svg", () => {
    const { container } = render(<Chevron dir="left" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws a different path per direction", () => {
    const paths = (["left", "right", "up", "down"] as const).map((dir) => {
      const { container } = render(<Chevron dir={dir} />);
      return container.querySelector("path")?.getAttribute("d");
    });
    expect(new Set(paths).size).toBe(4);
  });
});
