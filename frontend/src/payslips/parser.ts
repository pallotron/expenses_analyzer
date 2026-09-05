/**
 * Pure parsing of Irish PAYE payslip text into structured records.
 *
 * Ported from expenses/payslip_parser.py. PDF I/O is deliberately absent: this
 * module operates on text so it runs unchanged in a browser, a Worker or a
 * test, with no fixtures. See ./pdf.ts for the pdf.js adapter that feeds it.
 *
 * All money is integer cents. The Python original used floats and sprinkled
 * round(x, 2) over every derived property to hide the drift; in cents the
 * arithmetic is exact and those rounds disappear.
 */

/** A two-decimal number, optionally negative, with thousands separators. */
const AMOUNT = /-?\d[\d,]*\.\d{2}/g;

/**
 * Parse one matched amount into cents without going through a float.
 * "1,076.67" -> 107667, "-730.77" -> -73077.
 */
function amountToCents(raw: string): number {
  const cleaned = raw.replace(/,/g, "");
  const negative = cleaned.startsWith("-");
  const [whole, fraction] = (negative ? cleaned.slice(1) : cleaned).split(".");
  const cents = Number(whole) * 100 + Number(fraction);
  return negative ? -cents : cents;
}

/** Every 2-decimal number in `text`, as cents. */
export function extractAmounts(text: string): number[] {
  return [...text.matchAll(AMOUNT)].map((match) => amountToCents(match[0]));
}

/** One payroll run (one PDF). Gross and net are derived, not parsed. */
export class PayslipRun {
  salary = 0;
  bonus = 0;
  oncall = 0;
  reimbursements = 0;
  nonTaxableAdj = 0;
  miscDeductions = 0;
  pensionEe = 0;
  avc = 0;
  pensionEr = 0;
  paye = 0;
  prsiEe = 0;
  usc = 0;
  pensionEeYtd = 0;
  avcYtd = 0;
  pensionErYtd = 0;
  statedNet: number | null = null;

  readonly month: string;
  readonly sourceFile: string;

  // Written out rather than declared as constructor parameter properties:
  // those are one of the few TS features that emit runtime code, so they trip
  // type-stripping runtimes (node --experimental-strip-types among them).
  constructor(month: string, sourceFile: string) {
    this.month = month;
    this.sourceFile = sourceFile;
  }

  /** Cash earnings; excludes notional BIK and non-taxable adjustments. */
  get gross(): number {
    return this.salary + this.bonus + this.oncall + this.reimbursements;
  }

  get taxTotal(): number {
    return this.paye + this.prsiEe + this.usc;
  }

  get dedsFromGross(): number {
    return this.pensionEe + this.avc;
  }

  /** Take-home pay, mirroring the payslip's own NETT PAY arithmetic. */
  get net(): number {
    return (
      this.gross -
      this.dedsFromGross -
      this.taxTotal -
      this.miscDeductions +
      this.nonTaxableAdj
    );
  }

  /**
   * True if the derived net matches the net the payslip itself states.
   *
   * An earnings or deduction label this parser does not know is otherwise
   * invisible: it silently understates gross and net rather than failing.
   * Comparing against the payslip's own figure turns that into a flag. True
   * when the payslip states no net, since there is nothing to check.
   */
  get netReconciled(): boolean {
    if (this.statedNet === null) return true;
    return Math.abs(this.net - this.statedNet) < 1;
  }
}

/** Returns true when the line carried the full signature for its label. */
type Handler = (run: PayslipRun, nums: number[]) => boolean;

const handleSalary: Handler = (run, nums) => {
  if (nums.length) {
    run.salary = nums[0];
    return true;
  }
  return false;
};

/**
 * An adjustment to salary itself rather than a separate award. Covers both
 * directions: back pay adds salary earned earlier, unpaid leave subtracts
 * salary not earned, and the payslip signs the amount accordingly.
 */
const handleSalaryAdjustment: Handler = (run, nums) => {
  if (nums.length) run.salary += nums[0];
  return false;
};

const handleBonus: Handler = (run, nums) => {
  if (nums.length) run.bonus += nums[0];
  return false;
};

const handleOncall: Handler = (run, nums) => {
  if (nums.length) run.oncall = nums[0];
  return false;
};

/** A taxable reimbursement or subsidy, which counts toward gross. */
const handleDeviceReimbursement: Handler = (run, nums) => {
  if (nums.length) run.reimbursements += nums[0];
  return false;
};

/** A non-taxable adjustment, added after tax rather than to gross. */
const handleNonTaxable: Handler = (run, nums) => {
  if (nums.length) run.nonTaxableAdj += nums[0];
  return false;
};

/**
 * Notional pay / BIK, which is taxed but never paid in cash. Matched
 * explicitly so it is visibly excluded rather than silently ignored.
 */
const handleNotional: Handler = () => false;

const handleAvc: Handler = (run, nums) => {
  if (nums.length >= 2) {
    run.avc = nums[0];
    run.avcYtd = nums[1];
  }
  return false;
};

const handlePension: Handler = (run, nums) => {
  if (nums.length >= 4) {
    run.pensionEe = nums[0];
    run.pensionEeYtd = nums[1];
    run.pensionEr = nums[2];
    run.pensionErYtd = nums[3];
    return true;
  }
  return false;
};

const handlePaye: Handler = (run, nums) => {
  if (nums.length) run.paye = nums[0];
  return false;
};

const handlePrsi: Handler = (run, nums) => {
  if (nums.length) run.prsiEe = nums[0];
  return false;
};

/** Uses the 2nd amount: the period amount, not the base it was charged on. */
const handleUsc: Handler = (run, nums) => {
  if (nums.length >= 2) run.usc = nums[1];
  return false;
};

/**
 * Labels are matched case-insensitively on word boundaries, so payroll
 * providers that differ only in vocabulary and casing share this one parser.
 * A label may appear anywhere on a line, not just at the start: some providers
 * run two items together on a single extracted line.
 */
const HANDLERS: Record<string, Handler> = {
  salary: handleSalary,
  backpay: handleSalaryAdjustment,
  "retro pay": handleSalaryAdjustment,
  "unpaid leave": handleSalaryAdjustment,
  bonus: handleBonus,
  "sign on bonus": handleBonus,
  "bonus - prior year": handleBonus,
  "on-call": handleOncall,
  "device reimbursement": handleDeviceReimbursement,
  "device reimbur grossup": handleDeviceReimbursement,
  "health insurance sub": handleDeviceReimbursement,
  "device reimb(tax free)": handleNonTaxable,
  "working from home sub": handleNonTaxable,
  "subsistence vouched": handleNonTaxable,
  "travel vouched": handleNonTaxable,
  "small ben exemption": handleNotional,
  avc: handleAvc,
  pension: handlePension,
  "pension er": handlePension,
  paye: handlePaye,
  prsi: handlePrsi,
  usc: handleUsc,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Longest first so that at a shared start position the more specific label
 * wins ("Pension ER" over "Pension"). A trailing \b is omitted because some
 * labels end in a bracket, where a word boundary would not hold.
 */
const LABEL_RE = new RegExp(
  "\\b(?:" +
    Object.keys(HANDLERS)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|") +
    ")",
  "gi",
);

const TAX_KEYS = new Set(["paye", "prsi", "usc"]);

/**
 * Treat an unrecognised labelled line carrying 4 amounts as a misc deduction.
 *
 * Deductions such as a social club or health insurance premium are keyed by
 * provider-specific names that cannot be enumerated, but they share a fixed
 * shape with the statutory lines: period, period-YTD, employer, employer-YTD.
 * Matching on that shape keeps net accurate without hardcoding vendor names.
 */
function recordMiscDeduction(run: PayslipRun, line: string): void {
  const nums = extractAmounts(line);
  if (nums.length !== 4) return;
  const label = line.replace(AMOUNT, "").trim();
  if (!/\p{L}/u.test(label)) return;
  run.miscDeductions += nums[0];
}

/**
 * Apply every label found on `line`.
 *
 * Each label owns the text up to the next label, so a line carrying two items
 * assigns each its own amounts rather than the first swallowing both.
 */
function dispatchLine(run: PayslipRun, line: string): [boolean, boolean] {
  const matches = [...line.matchAll(LABEL_RE)];
  if (!matches.length) {
    recordMiscDeduction(run, line);
    return [false, false];
  }

  let sawPension = false;
  let sawTax = false;
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const next = matches[index + 1];
    const end = next ? next.index : line.length;
    const nums = extractAmounts(line.slice(start, end));
    const key = match[0].trim().toLowerCase().replace(/\s+/g, " ");
    if (HANDLERS[key](run, nums) && key.startsWith("pension")) sawPension = true;
    if (nums.length && TAX_KEYS.has(key)) sawTax = true;
  });
  return [sawPension, sawTax];
}

/**
 * The NETT PAY the payslip states, or null if it cannot be located.
 *
 * This layout emits its summary as a block of bare amounts followed by the
 * matching block of labels, so the figures cannot be read by their label. What
 * holds is the ordering: the summary is the last thing before the label block,
 * and net is its final entry.
 */
function findStatedNet(lines: string[]): number | null {
  for (const [index, line] of lines.entries()) {
    if (line.trim().toUpperCase() !== "NOTE") continue;
    const amounts = extractAmounts(lines.slice(0, index).join("\n"));
    return amounts.length ? amounts[amounts.length - 1] : null;
  }
  return null;
}

/**
 * Parse stripped payslip text lines into a PayslipRun.
 *
 * Returns null if the Irish-format signature is absent (a Pension line
 * carrying >= 4 amounts, plus at least one statutory tax line). This is the
 * "fail loudly" guard: an unrecognised layout is never guessed at.
 *
 * Salary is deliberately not part of the signature. A month can have a
 * supplementary run — an off-cycle bonus or on-call payment — which carries no
 * salary line but must still be aggregated into that month's totals.
 */
export function parseLines(
  lines: string[],
  month: string,
  sourceFile: string,
): PayslipRun | null {
  const run = new PayslipRun(month, sourceFile);
  run.statedNet = findStatedNet(lines);

  let sawPension = false;
  let sawTax = false;
  for (const raw of lines) {
    const [linePension, lineTax] = dispatchLine(run, raw.trim());
    sawPension = sawPension || linePension;
    sawTax = sawTax || lineTax;
  }

  if (!(sawPension && sawTax)) return null;
  return run;
}

/**
 * Constrained to a real year and month so an unrelated digit run in a filename
 * cannot be mistaken for a date.
 */
const MONTH_RE = /((?:19|20)\d{2}-(?:0[1-9]|1[0-2]))/;

/**
 * A YYYY-MM from anywhere in a payslip filename, or null.
 *
 * Not anchored to the start: a folder from a different employer may prefix its
 * payslips with a word, and those files still carry a usable month.
 */
export function monthFromFilename(name: string): string | null {
  const base = name.split("/").pop() ?? name;
  return MONTH_RE.exec(base)?.[1] ?? null;
}
