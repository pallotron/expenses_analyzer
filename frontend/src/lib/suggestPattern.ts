/**
 * _suggest_pattern from edit_merchant_screen.py: a starting regex for a raw
 * statement name. Drops everything from the first " dd/dd" date stamp onwards,
 * then a trailing number, escapes what is special in a regex, lets any run of
 * spaces match `\s+`, and always appends `.*` to accept any tail. Escaping is
 * one pass; the Python's two passes doubled backslashes.
 */
export function suggestPattern(raw: string): string {
  const cleaned = raw
    .replace(/\s+\d{2}\/\d{2}.*/, "")
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return `${escaped}.*`;
}
