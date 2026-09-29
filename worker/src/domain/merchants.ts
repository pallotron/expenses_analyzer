/**
 * Which merchant a statement line belongs to: data_handler.py's
 * normalize_merchant_name and apply_merchant_alias.
 *
 * Alias patterns were written as Python regexes and are stored verbatim. They
 * compile as JavaScript regexes here; the real-data test resolves every stored
 * transaction and requires the merchant the migration assigned, which is what
 * catches a pattern the two dialects read differently.
 */

/**
 * Everything from the first dd/mm onwards. \p{Nd} rather than \d because
 * Python's \d matches any Unicode digit.
 */
const DATE_STAMP = /\s*\p{Nd}{2}\/\p{Nd}{2}.*$/u;

/**
 * Drop the transaction date some feeds append: "POS ST VINCENTS 26/08 09" and
 * "POS ST VINCENTS 14/03 11" are the same shop. If stripping would leave
 * nothing, the name is kept as it was.
 */
export function normalizeMerchantName(name: string): string {
  if (!name) return name;
  return name.replace(DATE_STAMP, "").trim() || name;
}

export interface AliasRule {
  pattern: string;
  canonicalName: string;
}

export interface CompiledAlias {
  regex: RegExp;
  canonicalName: string;
}

/**
 * Compile in the order given, which must be priority order: the first match
 * wins. A pattern that does not compile is skipped, as the Python skipped a
 * re.error, so one bad rule cannot stop an import.
 */
export function compileAliases(
  rules: AliasRule[],
  onInvalid: (pattern: string, error: unknown) => void = () => {},
): CompiledAlias[] {
  const compiled: CompiledAlias[] = [];
  for (const { pattern, canonicalName } of rules) {
    try {
      compiled.push({ regex: new RegExp(pattern, "i"), canonicalName });
    } catch (error) {
      onInvalid(pattern, error);
    }
  }
  return compiled;
}

/** The canonical merchant name for a raw statement string. */
export function resolveMerchantName(raw: string, aliases: CompiledAlias[]): string {
  if (!raw) return raw;
  for (const { regex, canonicalName } of aliases) {
    if (regex.test(raw)) return canonicalName;
  }
  return normalizeMerchantName(raw);
}
