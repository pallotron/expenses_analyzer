/**
 * The hidden-tag sheet's rows, as the TUI's build_pattern_options lays them
 * out: a `ns:*` row per tag namespace, then every tag in use, then any hidden
 * pattern that no longer matches a tag, so it can still be unticked.
 */
export interface PatternOption {
  pattern: string;
  ticked: boolean;
}

export function patternOptions(tagsInUse: string[], excluded: string[]): PatternOption[] {
  const namespaces = [...new Set(tagsInUse.filter((t) => t.includes(":")).map((t) => `${t.split(":")[0]}:*`))].sort();
  const hidden = new Set(excluded);
  return [...new Set([...namespaces, ...tagsInUse, ...excluded])]
    .filter((p) => p !== "")
    .map((pattern) => ({ pattern, ticked: hidden.has(pattern) }));
}
