/** "8 October 2026, 14:05", in the reader's locale. */
const generated = (d: Date) =>
  d.toLocaleString(undefined, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Opens the print dialog, where "Save as PDF" writes the file. */
export function ExportPdfButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 print:hidden dark:border-slate-700 dark:hover:bg-slate-800">
      Export PDF
    </button>
  );
}

/** Stands in on paper for the controls, which do not print: what the report covers, and when. */
export function PrintHeader(props: { title: string; scope: string }) {
  return (
    <header aria-label="Report" className="flex flex-col gap-0.5 border-b border-slate-300 pb-2">
      <h1 className="text-lg font-semibold">{props.title}</h1>
      <p className="text-sm">{props.scope}</p>
      <p className="text-xs text-slate-500">Generated {generated(new Date())}</p>
    </header>
  );
}
