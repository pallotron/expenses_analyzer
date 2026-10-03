/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { SheetError, useSheetSubmit } from "../../lib/useSheetSubmit";

function Probe(props: { fn: (n: number) => Promise<string>; onSuccess: (r: string) => void }) {
  const m = useMutation({ mutationFn: props.fn });
  const s = useSheetSubmit(m, props.onSuccess);
  return (
    <div>
      <button type="button" onClick={() => s.run(7)}>Go</button>
      <button type="button" onClick={() => s.fail("Enter a pattern")}>Fail</button>
      <SheetError submit={s} onRetry={() => s.run(7)} />
    </div>
  );
}

const mount = (fn: (n: number) => Promise<string>, onSuccess = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><Probe fn={fn} onSuccess={onSuccess} /></QueryClientProvider>);
  return onSuccess;
};

describe("useSheetSubmit", () => {
  it("shows an API error as is, without Retry", async () => {
    mount(async () => { throw new ApiError(400, "Invalid pattern: x"); });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid pattern: x");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Retry after a network failure, and succeeds on it", async () => {
    let fail = true;
    const onSuccess = mount(async () => { if (fail) throw new TypeError("Failed to fetch"); return "ok"; });
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save: Failed to fetch");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("ok", 7));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a validation message without sending", async () => {
    const fn = vi.fn(async () => "ok");
    mount(fn);
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a pattern");
    expect(fn).not.toHaveBeenCalled();
  });
});
