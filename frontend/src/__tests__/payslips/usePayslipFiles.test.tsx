/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PayslipDecryptError, type LineExtractor } from "../../payslips/payslipFile";
import { usePayslipFiles } from "../../payslips/usePayslipFiles";

const LINES = [
  "Salary 5000.00", "Pension 500.00 500.00 500.00 500.00", "PAYE 1000.00 1000.00",
];
const file = (name: string) => new File([new Uint8Array([1])], name, { type: "application/pdf" });

/** Encrypted files need the password "pw"; "plain" files open without one. */
const extractor: LineExtractor = async (_data, password) => {
  if (password === "pw") return LINES;
  throw new PayslipDecryptError(password ? "Wrong password for this payslip" : "no password");
};
const plain: LineExtractor = async () => LINES;

const kinds = (r: { current: ReturnType<typeof usePayslipFiles> }) => r.current.files.map((f) => [f.file.name, f.status.kind]);

describe("usePayslipFiles", () => {
  it("parses each added file", async () => {
    const { result } = renderHook(() => usePayslipFiles("", plain));
    act(() => result.current.add([file("2026-01 pay.pdf"), file("notes.pdf")]));
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "ready"], ["notes.pdf", "noMonth"]]));
    expect(result.current.reading).toBe(false);
  });

  it("says when the layout is not recognised", async () => {
    const { result } = renderHook(() => usePayslipFiles("", async () => ["Total 1.00"]));
    act(() => result.current.add([file("2026-01 pay.pdf")]));
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "unrecognised"]]));
  });

  it("re-parses files that needed a password when the password changes", async () => {
    const { result, rerender } = renderHook(({ pw }) => usePayslipFiles(pw, extractor), { initialProps: { pw: "" } });
    act(() => result.current.add([file("2026-01 pay.pdf")]));
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "needsPassword"]]));
    rerender({ pw: "nope" });
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "wrongPassword"]]));
    rerender({ pw: "pw" });
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "ready"]]));
    expect(result.current.files).toHaveLength(1);
  });

  it("re-reads a file whose parse used an outdated password", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: LineExtractor = async (data, pw) => { await gate; return extractor(data, pw); };
    const { result, rerender } = renderHook(({ pw }) => usePayslipFiles(pw, slow), { initialProps: { pw: "" } });
    act(() => result.current.add([file("2026-01 pay.pdf")]));
    rerender({ pw: "pw" });
    await act(async () => release());
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 pay.pdf", "ready"]]));
  });

  it("ignores a parse that finishes after its line was removed", async () => {
    let release!: () => void;
    const slow: LineExtractor = () => new Promise((r) => { release = () => r(LINES); });
    const { result } = renderHook(() => usePayslipFiles("", slow));
    act(() => result.current.add([file("2026-01 pay.pdf")]));
    act(() => result.current.remove(result.current.files[0].id));
    // The extractor runs once the file's bytes are read, a tick after add().
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => release());
    expect(result.current.files).toEqual([]);
  });

  it("marks an ignored name for use when asked", async () => {
    const { result } = renderHook(() => usePayslipFiles("", plain));
    act(() => result.current.add([file("2026-01 draft.pdf")]));
    await waitFor(() => expect(kinds(result)).toEqual([["2026-01 draft.pdf", "ready"]]));
    act(() => result.current.useAnyway(result.current.files[0].id));
    expect(result.current.files[0].useAnyway).toBe(true);
  });
});
