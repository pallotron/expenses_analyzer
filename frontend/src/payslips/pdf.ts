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
 * Text items in the PDF's own (content-stream) order, starting a new line
 * whenever the baseline moves or pdf.js marks an end of line. This mirrors
 * how pypdf extracted text for the Python app, which is what the parser's
 * label-then-amounts logic and its NOTE summary block assume. Grouping by
 * baseline across the whole page instead merges separate columns into one
 * line ("... PRSI Code A1 + Gross Pay ..."), which the parser misreads.
 */
export function groupItemsIntoLines(items: TextItem[]): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let baseline: number | null = null;
  const flush = () => {
    const line = current.join(" ").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = [];
  };
  for (const item of items) {
    const y = item.transform[5];
    // Sub-pixel drift between items on one visual line is not a new line.
    if (baseline !== null && Math.abs(y - baseline) > 1) flush();
    if (item.str.trim()) current.push(item.str.trim());
    baseline = y;
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
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
