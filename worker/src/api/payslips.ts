/**
 * The Payslips API's JSON, shared with the frontend, which imports this file
 * directly. Keep it free of imports so the frontend can bundle it as is.
 *
 * All money is integer cents.
 */

/** The figures the parser reads from one payslip PDF, in cents. */
export interface RunParts {
  salaryCents: number;
  bonusCents: number;
  onCallCents: number;
  reimbursementsCents: number;
  nonTaxableAdjCents: number;
  miscDeductionsCents: number;
  pensionEeCents: number;
  avcCents: number;
  pensionErCents: number;
  payeCents: number;
  prsiEeCents: number;
  uscCents: number;
  pensionEeYtdCents: number;
  avcYtdCents: number;
  pensionErYtdCents: number;
  /** The net printed on the payslip; null when the parser could not find it. */
  statedNetCents: number | null;
}

/** What the Worker works out from the parts. */
export interface DerivedRun {
  grossCents: number;
  taxTotalCents: number;
  netCents: number;
  netReconciled: boolean;
}

export interface PayslipRunRow {
  sourceFile: string;
  grossCents: number;
  netCents: number;
  pensionEeCents: number;
  avcCents: number;
  pensionErCents: number;
  netReconciled: boolean;
}

export interface PayslipMonthRow {
  month: string;
  grossCents: number;
  netCents: number;
  taxTotalCents: number;
  pensionEeCents: number;
  avcCents: number;
  pensionErCents: number;
  bonusCents: number;
  onCallCents: number;
  netReconciled: boolean | null;
  ytdReconciled: boolean | null;
  /** Empty for a month the TUI saved. Sorted by file name. */
  runs: PayslipRunRow[];
}

export interface PayslipPerson {
  id: number;
  name: string;
  /** Newest first. */
  months: PayslipMonthRow[];
}

export interface PayslipsResponse { people: PayslipPerson[] }

export interface PayslipRunInput extends RunParts {
  sourceFile: string;
  month: string;
}

export interface PayslipImportRequest { userId: number; runs: PayslipRunInput[] }
export interface PayslipImportResponse {
  /** The months rebuilt: those imported plus each one's next month, re-checked. */
  months: string[];
  /** The months of the files in the request, sorted. */
  imported: string[];
  replaced: number;
  ytdMismatches: string[];
}
export interface PayslipRemoveRequest { userId: number; sourceFiles: string[] }
export interface PayslipRemoveResponse { months: string[] }

/** Most files one import or removal takes. */
export const MAX_PAYSLIP_FILES = 500;

export interface SourceOwnersResponse {
  /** Every import source in use, by name, with its owner or null. */
  sources: { source: string; userId: number | null }[];
  users: { id: number; name: string }[];
}
export interface SourceOwnerRequest { source: string; userId: number | null }
