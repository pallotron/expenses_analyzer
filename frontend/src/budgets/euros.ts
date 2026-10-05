import { MAX_BUDGET_CENTS } from "../lib/types";

/**
 * A typed budget in euros, as cents. Blank is no budget. Commas and a euro
 * sign are allowed ("€53,000"); at most two decimals. Parsed as text, so
 * "0.29" is 29 cents and not 28.999….
 */
export function parseEuros(text: string): { ok: true; cents: number | null } | { ok: false; error: string } {
  const t = text.replace(/[€,\s]/g, "");
  if (t === "") return { ok: true, cents: null };
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false, error: "Enter an amount in euros, like 53000" };
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_BUDGET_CENTS) return { ok: false, error: "A budget can be at most 10,000,000" };
  return { ok: true, cents };
}

/** The input's starting text: whole euros without decimals, else two. */
export function eurosText(cents: number | null): string {
  if (cents === null) return "";
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(euros) : `${euros}.${String(rest).padStart(2, "0")}`;
}
