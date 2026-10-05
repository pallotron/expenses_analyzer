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
