/** @vitest-environment jsdom */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ImportMapping, ImportSource } from "../../lib/types";
import { addFiles, api, csvFile, renderImport, statusOf, useHarness } from "./harness";

const reads = vi.hoisted(() => ({ hold: false as boolean }));
vi.mock("../../import/grid", async (orig) => {
  const real = await orig<typeof import("../../import/grid")>();
  return { ...real, readGrid: (f: File) => (reads.hold && f.name === "slow.csv" ? new Promise<never>(() => {}) : real.readGrid(f)) };
});

useHarness();

const CSV = "Started Date,Description,Amount\n2026-09-01 10:00:00,Corner Shop,-6.55\n";
const MAP: ImportMapping = { date: "Started Date", merchant: "Description", amount: "Amount", typeMode: "auto", dateOrder: "dmy" };
const SOURCES: ImportSource[] = [{ name: "Alpha", lastDate: "2026-08-31", mapping: MAP }];

describe("the import button while a file is still being read", () => {
  it("stays disabled", async () => {
    reads.hold = true;
    renderImport(api({ sources: SOURCES }));
    await addFiles([csvFile(CSV, "a.csv"), csvFile(CSV, "slow.csv")]);
    await userEvent.selectOptions(screen.getByLabelText("Source for a.csv"), "Alpha");
    await waitFor(() => expect(statusOf("a.csv")).toHaveTextContent("Ready"));
    expect(statusOf("slow.csv")).toHaveTextContent("Reading");
    expect(screen.getByRole("button", { name: /^Import \d+ files? · / })).toBeDisabled();
  });
});
