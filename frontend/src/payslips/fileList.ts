import type { PayslipRun } from "./parser";

/**
 * The Payslips page's dropped files and what reading each one found. Pure;
 * usePayslipFiles drives the parsing.
 */
export type FileStatus =
  | { kind: "reading" }
  | { kind: "ready"; run: PayslipRun }
  | { kind: "needsPassword" }
  | { kind: "wrongPassword" }
  | { kind: "unrecognised" }
  | { kind: "noMonth" }
  | { kind: "failed"; message: string };

export interface PayslipFile {
  id: number;
  file: File;
  status: FileStatus;
  /** Import it even though its name has an ignore token. */
  useAnyway: boolean;
  /** Bumped on every re-parse, so a late answer for an older parse is dropped. */
  version: number;
}

/** The TUI's DEFAULT_IGNORE, less one token: names with these are left out by default. */
export const IGNORE_TOKENS: readonly string[] = ["draft", "old", "wrong"];

export function ignoredBy(name: string): string | null {
  const low = name.toLowerCase();
  return IGNORE_TOKENS.find((t) => low.includes(t)) ?? null;
}

export function isImportable(f: PayslipFile): boolean {
  return f.status.kind === "ready" && (f.useAnyway || ignoredBy(f.file.name) === null);
}

export function needsReparse(f: PayslipFile): boolean {
  return f.status.kind === "needsPassword" || f.status.kind === "wrongPassword";
}

/** New files go at the end; one with a name already listed replaces that line. */
export function addFiles(list: PayslipFile[], files: File[], nextId: () => number): PayslipFile[] {
  const names = new Set(files.map((f) => f.name));
  return [
    ...list.filter((f) => !names.has(f.file.name)),
    ...files.map((file) => ({ id: nextId(), file, status: { kind: "reading" } as const, useAnyway: false, version: 0 })),
  ];
}
