import { useId } from "react";
import { normalizeTags } from "../../lib/types";

/** "a, b" as the Worker will store it: its own normalizeTags, so chips never lie. */
export function splitTags(text: string): string[] {
  return normalizeTags(text.split(","));
}

/** Chips for the tags so far, and a box that turns "a, b" or Enter into chips. */
export function TagInput(props: {
  value: string[]; onChange: (tags: string[]) => void;
  draft: string; onDraft: (text: string) => void;
  suggestions: string[]; label: string; autoFocus?: boolean;
}) {
  const listId = useId();
  const commit = (text: string) => {
    const add = splitTags(text).filter((t) => !props.value.includes(t));
    if (add.length) props.onChange([...props.value, ...add]);
    props.onDraft("");
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">{props.label}</span>
        <input list={listId} value={props.draft} autoFocus={props.autoFocus}
          className="rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"
          onChange={(e) => {
            const v = e.target.value;
            // A datalist pick replaces the text in one step, as a plain change
            // or an "insertReplacementText" input; typing arrives as insertText.
            const native = e.nativeEvent as InputEvent;
            const picked = native.inputType === undefined || native.inputType === "insertReplacementText";
            if (v.includes(",") || (picked && props.suggestions.includes(v))) commit(v); else props.onDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(props.draft); }
            if (e.key === "Backspace" && props.draft === "" && props.value.length) props.onChange(props.value.slice(0, -1));
          }} />
      </label>
      <datalist id={listId}>{props.suggestions.map((t) => <option key={t} value={t} />)}</datalist>
      {props.value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen tags">
          {props.value.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
              <span>{t}</span>
              <button type="button" aria-label={`Remove ${t}`} onClick={() => props.onChange(props.value.filter((x) => x !== t))}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
