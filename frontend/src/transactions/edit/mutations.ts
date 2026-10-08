import { useMutation, useQueryClient } from "@tanstack/react-query";
import { send } from "../../lib/api";
import { invalidateData } from "../../lib/queryClient";
import type {
  BulkEditRequest, DeletedResponse, RestoredResponse, TaggedResponse, TagRequest, TransactionEdit, UpdatedResponse,
} from "../../lib/types";

/** Every write marks every view stale; `saves: false` is for a call that changes nothing. */
export function useWrite<V, R>(fn: (vars: V) => Promise<R>, opts: { saves?: boolean } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => (opts.saves === false ? undefined : invalidateData(client)),
  });
}

export const useEditOne = () =>
  useWrite(({ id, edit }: { id: number; edit: TransactionEdit }) => send<{ ok: true }>("PATCH", `/api/transactions/${id}`, edit));
export const useBulkEdit = () => useWrite((body: BulkEditRequest) => send<UpdatedResponse>("POST", "/api/transactions/bulk-edit", body));
export const useDelete = () => useWrite((ids: number[]) => send<DeletedResponse>("POST", "/api/transactions/delete", { ids }));
export const useRestore = () => useWrite((ids: number[]) => send<RestoredResponse>("POST", "/api/transactions/restore", { ids }));
export const useTag = () => useWrite((body: TagRequest) => send<TaggedResponse>("POST", "/api/transactions/tags", body));
