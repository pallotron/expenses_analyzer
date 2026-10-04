import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCheckQueue } from "../../import/checkQueue";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the check queue", () => {
  it("waits for a pause and runs only the latest schedule for a row", async () => {
    const run = vi.fn(async () => {});
    const q = createCheckQueue({ run });
    q.schedule("a", 1);
    await vi.advanceTimersByTimeAsync(200);
    q.schedule("a", 2);
    await vi.advanceTimersByTimeAsync(399);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.mock.calls).toEqual([["a", 2]]);
  });

  it("runs at most three at once, starting the next as one finishes", async () => {
    const done: (() => void)[] = [];
    const run = vi.fn(() => new Promise<void>((resolve) => done.push(resolve)));
    const q = createCheckQueue({ run });
    for (const id of ["a", "b", "c", "d", "e"]) q.schedule(id, 1);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(3);
    done[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls.map((c) => c.at(0))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps going when a run fails", async () => {
    const run = vi.fn(async (id: string) => { if (id === "a") throw new Error("down"); });
    const q = createCheckQueue({ run, limit: 1 });
    q.schedule("a", 1);
    q.schedule("b", 1);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("drops a cancelled row, waiting or not yet due", async () => {
    const run = vi.fn(async () => {});
    const q = createCheckQueue({ run, limit: 1 });
    q.schedule("a", 1);
    q.schedule("b", 1);
    q.cancel("b");
    await vi.advanceTimersByTimeAsync(400);
    q.schedule("c", 1);
    q.cancelAll();
    await vi.advanceTimersByTimeAsync(400);
    expect(run.mock.calls).toEqual([["a", 1]]);
  });
});
