/**
 * PDF text extraction for payslips, replacing pypdf from the Python app.
 *
 * This runs in the browser, deliberately: the PDF and the text pulled out of
 * it never leave the machine, and only the parsed numbers are sent to the API.
 * Payslips name the employer on every page, so keeping the document local is
 * what stops that reaching the server at all.
 *
 * The Python `resolve_password` has no counterpart here. It read a pin.txt
 * beside the PDF or the PAYSLIP_PDF_PASSWORD env var; a browser has neither,
 * so the password is supplied by whoever is uploading.
 */
import * as pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PayslipDecryptError } from "./payslipFile";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { PayslipDecryptError, parsePayslip, type LineExtractor } from "./payslipFile";

/**
 * pdf.js splits a line into several text items and reports each one's
 * position. Items sharing a baseline belong to the same visual line, which is
 * what the parser's label-then-amounts logic assumes; without regrouping them
 * every amount would arrive on a line of its own.
 */
function groupItemsIntoLines(items: TextItem[]): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    // transform[5] is the y translation. Round to absorb sub-pixel drift
    // between items that are visually on one line.
    const y = Math.round(item.transform[5]);
    const row = rows.get(y);
    if (row) row.push(item);
    else rows.set(y, [item]);
  }

  return [...rows.entries()]
    .sort(([a], [b]) => b - a) // top of the page downwards
    .map(([, row]) =>
      row
        .sort((a, b) => a.transform[4] - b.transform[4]) // left to right
        .map((item) => item.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/**
 * One worker for every parse. Without it pdf.js starts a worker per
 * getDocument call, and a folder of payslips (plus a re-read per password
 * typed) would leave dozens running. Created on first use, so importing this
 * module starts nothing.
 */
let shared: pdfjs.PDFWorker | null = null;
function sharedWorker(): pdfjs.PDFWorker {
  if (!shared || shared.destroyed) shared = new pdfjs.PDFWorker();
  return shared;
}

/** Extract text lines from a (possibly encrypted) PDF. */
export async function extractTextLines(
  data: ArrayBuffer,
  password?: string,
): Promise<string[]> {
  // The worker is passed in, so destroying the task closes this document
  // only and leaves the shared worker running.
  const task = pdfjs.getDocument({ data, password, worker: sharedWorker() });
  try {
    let document;
    try {
      document = await task.promise;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "PasswordException") {
        throw new PayslipDecryptError(
          password
            ? "Wrong password for this payslip"
            : "This payslip is encrypted but no password was provided",
        );
      }
      throw error;
    }

    const lines: string[] = [];
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      lines.push(
        ...groupItemsIntoLines(
          content.items.filter((item): item is TextItem => "str" in item),
        ),
      );
    }
    return lines;
  } finally {
    // A failed clean-up must not hide the parse's own result or error.
    await task.destroy().catch(() => {});
  }
}
