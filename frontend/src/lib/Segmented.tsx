export function Segmented<T extends string>(props: {
  label: string; options: [T | undefined, string][]; value: T | undefined; onChange: (v: T | undefined) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
      {props.options.map(([value, text]) => (
        <button key={text} type="button" aria-pressed={props.value === value} onClick={() => props.onChange(value)}
          className={`px-2.5 py-1 ${props.value === value ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : ""}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
