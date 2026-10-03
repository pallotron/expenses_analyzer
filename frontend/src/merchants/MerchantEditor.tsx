import { useEffect, useId, useRef, useState } from "react";
import { Sheet } from "../lib/Sheet";
import { suggestPattern } from "../lib/suggestPattern";
import type { LookupsResponse, MerchantRow } from "../lib/types";
import { useDebounced } from "../lib/useDebounced";
import { SheetError, useSheetSubmit } from "../lib/useSheetSubmit";
import { splitTags, TagInput } from "../transactions/edit/TagInput";
import { CategoryInput } from "./CategoryInput";
import { useDeleteRule, useSaveDecision } from "./mutations";
import { useAliasPreview, useRuleLookup } from "./queries";
import { RulePreview } from "./RulePreview";

export type EditorTarget = { kind: "raw"; raw: string } | { kind: "merchant"; merchant: MerchantRow };

interface Start { pattern: string; alias: string; category: string; ruleId: number | null }

const field = "rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900";
const NEW_RULE = "new";

function compileError(pattern: string): string | null {
  if (!pattern) return null;
  try { new RegExp(pattern, "i"); return null; } catch (e) { return (e as Error).message; }
}

export function MerchantEditor(props: {
  target: EditorTarget | null; lookups: LookupsResponse | undefined;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const { target } = props;
  const raw = target?.kind === "raw" ? target.raw : null;
  const merchant = target?.kind === "merchant" ? target.merchant : null;
  const lookup = useRuleLookup(raw);
  const save = useSaveDecision();
  const del = useDeleteRule();
  const [pattern, setPattern] = useState("");
  const [alias, setAlias] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | typeof NEW_RULE>(NEW_RULE);
  const [confirming, setConfirming] = useState(false);
  const patternHint = useId();

  const finish = (message: string) => { props.onDone(message); props.onClose(); };
  const saver = useSheetSubmit(save, ({ repointed, tagged }, v) =>
    finish(`Saved ${v.alias}: re-pointed ${repointed}${tagged ? `, tagged ${tagged}` : ""}`));
  const deleter = useSheetSubmit(del, ({ repointed }) => finish(`Rule deleted: re-pointed ${repointed}`));

  const apply = (s: Start) => { setPattern(s.pattern); setAlias(s.alias); setCategory(s.category); setRuleId(s.ruleId); };

  // The form restarts when the target really changes (a different raw text or merchant) and
  // when that target's start values first arrive; an unrelated parent render must not wipe edits.
  const key = raw !== null ? `raw:${raw}` : merchant ? `merchant:${merchant.id}` : null;
  const initialised = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) {
      initialised.current = null;
      apply({ pattern: "", alias: "", category: "", ruleId: null });
      return;
    }
    if (initialised.current === key) return;
    setTags([]); setDraft(""); setConfirming(false); saver.reset(); deleter.reset();
    if (merchant) {
      const rule = merchant.rules[0];
      setPicked(rule ? rule.id : NEW_RULE);
      apply({
        pattern: rule?.pattern ?? suggestPattern(merchant.name), alias: rule ? merchant.name : "",
        category: merchant.category ?? "", ruleId: rule?.id ?? null,
      });
      initialised.current = key;
    } else if (raw !== null && lookup.data && !lookup.isFetching) {
      // A cached answer that is refetching may be stale; wait for the fresh one.
      const { rule, merchant: name, category: cat } = lookup.data;
      apply({ pattern: rule?.pattern ?? suggestPattern(raw), alias: rule ? name : "", category: cat ?? "", ruleId: rule?.id ?? null });
      initialised.current = key;
    } else {
      apply({ pattern: "", alias: "", category: "", ruleId: null });
    }
  }, [key, lookup.data, lookup.isFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (value: number | typeof NEW_RULE) => {
    if (!merchant) return;
    setPicked(value);
    const rule = merchant.rules.find((r) => r.id === value);
    apply(rule
      ? { pattern: rule.pattern, alias: merchant.name, category, ruleId: rule.id }
      : { pattern: suggestPattern(merchant.name), alias: "", category, ruleId: null });
  };

  const preview = useAliasPreview(useDebounced(pattern, 300), useDebounced(alias, 300), target !== null);
  const invalid = compileError(pattern);
  const allTags = [...new Set([...tags, ...splitTags(draft)])];
  const busy = save.isPending || del.isPending;
  // Until fresh start values arrive; a later background refetch must not lock the form.
  const loading = raw !== null && (!lookup.data || (lookup.isFetching && initialised.current !== key));
  const cat = category.trim();

  const submit = () => {
    if (busy || loading || invalid) return;
    if (!pattern.trim()) { saver.fail("Enter a pattern"); return; }
    if (!alias.trim()) { saver.fail("Enter a display name"); return; }
    saver.run({
      pattern, alias: alias.trim(),
      ...(cat && { category: cat }), ...(allTags.length && { tags: allTags }),
    });
  };

  return (
    <Sheet title="Merchant rule" open={target !== null} onClose={props.onClose} busy={busy}>
      <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="text-xs text-slate-500">{raw !== null ? `Statement text: ${raw}` : `Merchant: ${merchant?.name}`}</p>
        {merchant && merchant.rules.length > 1 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-slate-500">Rule</legend>
            {merchant.rules.map((r) => (
              <label key={r.id} className="flex items-center gap-2">
                <input type="radio" name="rule" checked={picked === r.id} onChange={() => pick(r.id)} />
                <span className="font-mono text-xs">{r.pattern}</span>
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input type="radio" name="rule" checked={picked === NEW_RULE} onChange={() => pick(NEW_RULE)} />
              <span>New rule</span>
            </label>
          </fieldset>
        )}
        {raw !== null && lookup.isError && (
          <p role="alert" className="text-sm text-expense">
            Couldn't load the rule for this merchant.
            <button type="button" onClick={() => void lookup.refetch()} className="ml-2 underline">Retry</button>
          </p>
        )}
        <fieldset disabled={loading} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Pattern</span>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false}
            aria-describedby={patternHint} className={`${field} font-mono`} />
        </label>
        <span id={patternHint} className="text-xs text-slate-500">
          <code>.*</code> matches anything, <code>\d</code> a digit, <code>\s</code> a space
        </span>
        {invalid && <p role="alert" className="text-sm text-expense">Invalid pattern: {invalid}</p>}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Display name</span>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} className={field} />
        </label>
        <CategoryInput value={category} onChange={setCategory} categories={props.lookups?.categories ?? []} />
        {cat && (
          <span className="text-xs text-slate-500">
            Budget: {props.lookups?.essentialCategories.includes(cat) ? "Essential" : "Discretionary"} (from category)
          </span>
        )}
        <TagInput label="Tags to add" value={tags} onChange={setTags} draft={draft} onDraft={setDraft}
          suggestions={props.lookups?.tags ?? []} />
        </fieldset>
        {!invalid && <RulePreview preview={preview.data} category={cat} tags={allTags} />}
        <SheetError submit={saver} onRetry={submit} />
        <SheetError submit={deleter} onRetry={() => ruleId !== null && deleter.run(ruleId)} />
        {confirming && ruleId !== null ? (
          <div className="flex flex-col gap-2">
            <p>Matching rows go back to their own names or the next rule.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => deleter.run(ruleId)} disabled={busy}
                className="text-expense underline disabled:opacity-40">Delete rule</button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="underline">Keep</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pt-1">
            {ruleId !== null ? (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy}
                className="px-1 text-expense underline disabled:opacity-40">Delete rule</button>
            ) : <span />}
            <button type="submit" disabled={busy || loading || !!invalid}
              className="rounded-md bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
