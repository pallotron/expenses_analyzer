import { describe, it, expect } from "vitest";
import { parsePayslip, type LineExtractor } from "../../payslips/pdf";

// Mirrors the Python test that patched extract_text_lines: the composition of
// filename -> month and extracted lines -> PayslipRun is what matters here.
// Text extraction itself needs a real PDF and is exercised in the browser.
const JULY_LINES = [
  "Salary 13458.33",
  "USC on 112658.19 1025.14 6697.18 0.00 0.00",
  "AVC 269.17 1884.18 0.00 0.00",
  "Pension 1076.67 7536.68 1076.67 7536.68",
  "PAYE 5163.77 33752.41",
  "PRSI 711.85 4731.59 1906.76 12674.01",
];

function fakeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

const stubExtractor: LineExtractor = async () => JULY_LINES;

describe("parsePayslip", () => {
  it("parses the extracted lines under the month from the filename", async () => {
    const run = await parsePayslip(fakeFile("2026-07.pdf"), undefined, stubExtractor);
    expect(run).not.toBeNull();
    expect(run!.month).toBe("2026-07");
    expect(run!.sourceFile).toBe("2026-07.pdf");
    expect(run!.pensionEe).toBe(107667);
  });

  it("returns null when the filename carries no month", async () => {
    expect(await parsePayslip(fakeFile("notes.pdf"), undefined, stubExtractor)).toBeNull();
  });

  it("returns null when the layout is not recognised", async () => {
    const unrecognised: LineExtractor = async () => ["Total Pay 1000.00"];
    expect(await parsePayslip(fakeFile("2026-07.pdf"), undefined, unrecognised)).toBeNull();
  });

  it("passes the password through to the extractor", async () => {
    let seen: string | undefined;
    const capturing: LineExtractor = async (_data, password) => {
      seen = password;
      return JULY_LINES;
    };
    await parsePayslip(fakeFile("2026-07.pdf"), "hunter2", capturing);
    expect(seen).toBe("hunter2");
  });
});
