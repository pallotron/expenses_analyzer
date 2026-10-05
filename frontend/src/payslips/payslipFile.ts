import { monthFromFilename, parseLines, type PayslipRun } from "./parser";

/** Raised when an encrypted payslip cannot be opened with the given password. */
export class PayslipDecryptError extends Error {}

/** Swappable so parsePayslip can be tested without a PDF fixture. */
export type LineExtractor = (
  data: ArrayBuffer,
  password?: string,
) => Promise<string[]>;

/**
 * Parse a single payslip PDF into a PayslipRun, or null if the month cannot be
 * derived from the filename or the layout is not recognised.
 */
export async function parsePayslip(
  file: File,
  password: string | undefined,
  extractor: LineExtractor,
): Promise<PayslipRun | null> {
  const month = monthFromFilename(file.name);
  if (month === null) return null;
  const lines = await extractor(await file.arrayBuffer(), password);
  return parseLines(lines, month, file.name);
}
