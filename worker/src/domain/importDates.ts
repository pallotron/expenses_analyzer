/**
 * import_screen.py's _parse_date_smart, as the dates the web import accepts:
 * ISO (a time after it is dropped), numeric day/month/year with "/", "-" or
 * "." read day-first unless asked otherwise, and English text months. Held to
 * the Python by python_vectors.json ("import.dates"), except "." dates and
 * short years, which the TUI got wrong.
 */

export type DateOrder = "dmy" | "mdy";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const ISO = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/;
const NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T].*)?$/;
const DAY_MONTH = /^(\d{1,2})\s+([A-Za-z]+\.?),?\s+(\d{4})$/;
const MONTH_DAY = /^([A-Za-z]+\.?)\s+(\d{1,2}),?\s+(\d{4})$/;

const pad = (n: number) => String(n).padStart(2, "0");

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "Mar", "march", "Sept" -> 3, 3, 9; at least three letters of a month's name. */
function monthNumber(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

export function parseDate(raw: string, order: DateOrder = "dmy"): string | null {
  const s = raw.trim();
  let m = ISO.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = NUMERIC.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [day, month] = order === "dmy" ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    return toIso(year, month, day);
  }
  m = DAY_MONTH.exec(s);
  if (m) {
    const month = monthNumber(m[2]);
    return month ? toIso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = MONTH_DAY.exec(s);
  if (m) {
    const month = monthNumber(m[1]);
    return month ? toIso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}
