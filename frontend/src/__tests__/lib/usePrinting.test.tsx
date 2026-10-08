/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { usePrinting } from "../../lib/usePrinting";

function Probe(props: { title?: string }) {
  return <p>{usePrinting(props.title) ? "printing" : "screen"}</p>;
}

const fire = (type: "beforeprint" | "afterprint") => act(() => { window.dispatchEvent(new Event(type)); });

afterEach(() => fire("afterprint"));

describe("usePrinting", () => {
  it("is true between beforeprint and afterprint", () => {
    render(<Probe />);
    expect(screen.getByText("screen")).toBeInTheDocument();
    fire("beforeprint");
    expect(screen.getByText("printing")).toBeInTheDocument();
    fire("afterprint");
    expect(screen.getByText("screen")).toBeInTheDocument();
  });

  it("names the document while printing, so the PDF gets that file name", () => {
    document.title = "Expenses";
    render(<Probe title="Summary 2026" />);
    fire("beforeprint");
    expect(document.title).toBe("Summary 2026");
    fire("beforeprint");
    fire("afterprint");
    expect(document.title).toBe("Expenses");
  });
});
