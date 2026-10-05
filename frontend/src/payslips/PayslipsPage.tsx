import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getJson } from "../lib/api";
import { isImportable } from "./fileList";
import { entriesOf, filesFromEntries } from "./droppedFiles";
import { PayslipFileRow } from "./PayslipFileRow";
import { forgetPassword, loadPassword, savePassword } from "./passwords";
import type { PayslipRun } from "./parser";
import type { LineExtractor } from "./payslipFile";
import { useImportPayslips, usePayslips } from "./queries";
import { SavedPayslips } from "./SavedPayslips";
import { usePayslipFiles } from "./usePayslipFiles";

const muted = "text-sm text-slate-600 dark:text-slate-400";

/** /payslips: the TUI's `y`. PDFs are read here; only their figures are sent. */
export function PayslipsPage(props: { extractor?: LineExtractor }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => getJson<{ id: number }>("/api/me"), staleTime: Infinity });
  const saved = usePayslips();
  const [chosen, setChosen] = useState<number | null>(null);
  const personId = chosen ?? me.data?.id ?? null;
  const [passwords, setPasswords] = useState<Record<number, string>>({});
  const password = personId === null ? "" : (passwords[personId] ?? loadPassword(personId));
  const files = usePayslipFiles(password, props.extractor);
  const save = useImportPayslips();
  const [dragging, setDragging] = useState(false);
  const [noPdfs, setNoPdfs] = useState(false);
  const take = (picked: File[]) => setNoPdfs(files.add(picked) === 0);

  if (saved.isPending || me.isPending) return <main className="mx-auto max-w-4xl p-4" aria-busy="true"><p className={muted}>Loading payslips…</p></main>;
  if (saved.error) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <p role="alert" className="text-sm text-expense">Couldn't load the payslips: {saved.error.message}
          <button type="button" onClick={() => saved.refetch()} className="ml-2 underline">Retry</button></p>
      </main>
    );
  }
  const people = saved.data.people;
  const person = people.find((p) => p.id === personId) ?? people[0];
  const savedNames = new Set(person.months.flatMap((m) => m.runs.map((r) => r.sourceFile)));
  const tuiMonths = new Set(person.months.filter((m) => m.runs.length === 0).map((m) => m.month));
  const ready = files.files.filter(isImportable);
  const setPassword = (pw: string) => { setPasswords((p) => ({ ...p, [person.id]: pw })); savePassword(person.id, pw); };

  const submit = () => save.mutate(
    { userId: person.id, runs: ready.map((f) => {
      const run = (f.status as { kind: "ready"; run: PayslipRun }).run;
      return { ...run.toParts(), sourceFile: f.file.name, month: run.month };
    }) },
    { onSuccess: () => files.clear(ready.map((f) => f.id)) },
  );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Payslips</h1>
      <p className={`-mt-2 ${muted}`}>PDFs are read in this browser. Only the figures are saved.</p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Person</span>
          <select value={person.id} onChange={(e) => { setChosen(Number(e.target.value)); save.reset(); }} disabled={save.isPending}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">PDF password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off"
            className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950" />
        </label>
        {password && <button type="button" className="pb-1.5 underline"
          onClick={() => { forgetPassword(person.id); setPasswords((p) => ({ ...p, [person.id]: "" })); }}>Forget</button>}
      </div>
      <p className="-mt-2 text-xs text-slate-500">The password is remembered in this browser only and never sent.</p>

      <label className="flex flex-col gap-1 text-sm">
        <span data-dropzone
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            // Read both now: the drop's items are gone once this handler returns.
            const entries = entriesOf(e.dataTransfer);
            const plain = Array.from(e.dataTransfer.files);
            void (entries ? filesFromEntries(entries).catch(() => plain) : Promise.resolve(plain)).then(take);
          }}
          className={`flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-3 py-2 ${
            dragging ? "border-slate-500 bg-slate-100 dark:border-slate-400 dark:bg-slate-800" : "border-slate-300 dark:border-slate-700"}`}>
          <input aria-label="Payslip PDFs" type="file" multiple accept=".pdf,application/pdf" disabled={save.isPending}
            onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ""; take(picked); }}
            className="w-56 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1 file:text-sm dark:file:border-slate-700 dark:file:bg-slate-900" />
          <span>Drop payslip PDFs here or choose them, a month's or a whole folder's</span>
        </span>
      </label>
      {noPdfs && <p className={`-mt-2 ${muted}`}>No PDFs in what was dropped</p>}

      {files.files.length > 0 && (
        <>
          <ul aria-label="Payslips to import" className="flex flex-col">
            {files.files.map((f) => (
              <PayslipFileRow key={f.id} file={f} saved={savedNames} tuiMonths={tuiMonths} disabled={save.isPending}
                onRemove={() => files.remove(f.id)} onUseAnyway={() => files.useAnyway(f.id)} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={submit} disabled={ready.length === 0 || files.reading || save.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900">
              {save.isPending ? "Importing…" : `Import ${ready.length} file${ready.length === 1 ? "" : "s"}`}
            </button>
            <span className={muted}>for {person.name}</span>
          </div>
        </>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-expense">Couldn't import: {save.error.message}
          <button type="button" onClick={submit} className="ml-2 underline">Retry</button></p>
      )}
      {save.data && !save.isPending && (
        <p role="status" className="text-sm">
          Saved {save.data.imported.join(", ")}{save.data.replaced > 0 && ` · replaced ${save.data.replaced} file${save.data.replaced === 1 ? "" : "s"}`}
          {save.data.ytdMismatches.map((m) => <span key={m} className="block text-amber-600 dark:text-amber-400">⚠ {m}'s year-to-date pension does not add up</span>)}
        </p>
      )}

      <section aria-labelledby="saved-payslips" className="flex flex-col gap-2">
        <h2 id="saved-payslips" className="font-semibold">Saved payslips: {person.name}</h2>
        <SavedPayslips key={person.id} person={person} />
      </section>
    </main>
  );
}
