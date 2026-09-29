/**
 * Tag rules: expenses/tags.py.
 *
 * A tag is lowercase [a-z0-9:_-], spaces become "-". An exclusion pattern is a
 * tag, optionally ending in one "*" for prefix matching ("trip:*").
 *
 * The database keeps tags as rows, not a comma-separated cell, but the cell
 * helpers are ported too: they are how tags arrive in CSV imports and how the
 * snapshot view presents them.
 */

const INVALID_CHARS = /[^a-z0-9:_-]/g;

/** Lowercase, trim, spaces to "-", drop anything else outside [a-z0-9:_-]. */
export function normalizeTag(raw: string): string {
  return String(raw).trim().toLowerCase().replaceAll(" ", "-").replace(INVALID_CHARS, "");
}

/** Split a stored cell. Empty, null and stray commas yield nothing. */
export function parseTags(cell: string | null | undefined): string[] {
  if (cell == null) return [];
  return String(cell).split(",").filter((t) => t);
}

/** Normalise and de-duplicate, keeping first-seen order. */
export function normalizeTags(tags: string[]): string[] {
  const seen: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag && !seen.includes(tag)) seen.push(tag);
  }
  return seen;
}

export function joinTags(tags: string[]): string {
  return normalizeTags(tags).join(",");
}

export function addTagsToCell(cell: string | null | undefined, tags: string[]): string {
  return joinTags([...parseTags(cell), ...tags]);
}

export function removeTagsFromCell(cell: string | null | undefined, tags: string[]): string {
  const remove = new Set(tags.map(normalizeTag));
  return joinTags(parseTags(cell).filter((t) => !remove.has(t)));
}

/** A tag with one optional trailing "*". Misplaced stars are stripped. */
export function normalizePattern(raw: string): string {
  const text = String(raw).trim().toLowerCase();
  if (text.endsWith("*")) return `${normalizeTag(text.slice(0, -1))}*`;
  return normalizeTag(text);
}

export function isValidPattern(pattern: string): boolean {
  let text = String(pattern);
  if (text.endsWith("*")) text = text.slice(0, -1);
  return Boolean(text) && !text.includes("*") && normalizeTag(text) === text;
}

/** Exact match, or prefix match for a pattern ending in "*". */
export function cellMatchesPatterns(
  cell: string | null | undefined,
  patterns: string[],
): boolean {
  const tokens = parseTags(cell);
  if (tokens.length === 0) return false;
  for (const raw of patterns) {
    const pattern = normalizePattern(raw);
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (prefix && tokens.some((t) => t.startsWith(prefix))) return true;
    } else if (pattern && tokens.includes(pattern)) {
      return true;
    }
  }
  return false;
}
