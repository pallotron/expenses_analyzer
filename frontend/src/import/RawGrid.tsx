const SHOWN = 20;

/** The first rows of the file exactly as read, numbered like the "Header row" field. */
export function RawGrid(props: { grid: string[][]; headerRow: number }) {
  const rows = props.grid.slice(0, SHOWN);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Show the file as read</summary>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table aria-label="File as read" className="w-full text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} aria-current={i === props.headerRow ? "true" : undefined}
                className={`border-t border-slate-100 first:border-t-0 dark:border-slate-800 ${
                  i === props.headerRow ? "bg-amber-50 font-semibold dark:bg-amber-950/40" : ""}`}>
                <td className="p-1.5 text-right text-slate-400 tabular-nums">{i + 1}</td>
                {Array.from({ length: width }, (_, c) => {
                  const text = r[c] ?? "";
                  return <td key={c} title={text} className="max-w-48 truncate p-1.5 whitespace-nowrap">{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.grid.length > SHOWN && (
        <p className="mt-1 text-slate-500 dark:text-slate-400">{`First ${SHOWN} of ${props.grid.length} rows`}</p>
      )}
    </details>
  );
}
