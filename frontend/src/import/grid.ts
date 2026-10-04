import Papa from "papaparse";

/**
 * A bank export as rows of text cells, whatever the format, so the mapping
 * and parsing (domain/importRows) see one shape. SheetJS is loaded only when
 * a spreadsheet is picked, so the rest of the app never downloads it.
 */

export class UnsupportedFileError extends Error {}

export async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return csvGrid(await file.text());
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return sheetGrid(await file.arrayBuffer());
  throw new UnsupportedFileError("Choose a .csv, .xls or .xlsx file");
}

export function csvGrid(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimitersToGuess: [",", ";", "\t"] });
  return parsed.data.map((row) => row.map((cell) => cell ?? ""));
}

const pad = (n: number) => String(n).padStart(2, "0");

function cellText(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

export async function sheetGrid(data: ArrayBuffer): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(data, { type: "array", cellDates: true, UTC: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true, UTC: true });
  const text = rows.map((row) => row.map(cellText));
  // sheet_to_json starts at the sheet's first used cell; line numbers must match the spreadsheet's.
  const { s } = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  return [...Array.from({ length: s.r }, () => [] as string[]), ...text.map((row) => [...Array(s.c).fill(""), ...row])];
}
