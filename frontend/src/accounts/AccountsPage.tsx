import { useSetSourceOwner, useSourceOwners } from "./queries";

/**
 * /accounts: whose account each import source is. Today the Summary uses it to
 * count only the owners' pension when filtered by source. "No one" is for
 * shared accounts and accounts that belong to neither person.
 */
export function AccountsPage() {
  const owners = useSourceOwners();
  const save = useSetSourceOwner();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-4 text-sm">
      <h1 className="text-lg font-semibold">Accounts</h1>
      <p className="text-slate-600 dark:text-slate-400">
        Whose account each source is. When the Summary is filtered by source, only the owners' pension is counted.
      </p>
      {owners.isPending && <p className="text-slate-500" aria-busy="true">Loading accounts…</p>}
      {owners.error && (
        <p role="alert" className="text-expense">Couldn't load the accounts: {owners.error.message}
          <button type="button" onClick={() => owners.refetch()} className="ml-2 underline">Retry</button></p>
      )}
      {owners.data && (
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {owners.data.sources.map((s) => (
            <li key={s.source} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 break-all">{s.source}</span>
              <select aria-label={`Owner of ${s.source}`} value={s.userId ?? ""} disabled={save.isPending}
                onChange={(e) => save.mutate({ source: s.source, userId: e.target.value === "" ? null : Number(e.target.value) })}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
                <option value="">No one</option>
                {owners.data.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
      {save.error && <p role="alert" className="text-expense">Couldn't save: {save.error.message}</p>}
    </main>
  );
}
