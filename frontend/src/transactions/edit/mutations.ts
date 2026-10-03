import { useMutation, useQueryClient } from "@tanstack/react-query";
import { send } from "../../lib/api";
import type {
  BulkEditRequest, DeletedResponse, RestoredResponse, TaggedResponse, TagRequest, TransactionEdit, UpdatedResponse,
} from "../../lib/types";

/** Every query a write can change: the list, the Summary, the periods, the lookups, and merchants. */
const AFFECTED = ["transactions", "summary", "periods", "lookups", "merchants"];

export function useWrite<V, R>(fn: (vars: V) => Promise<R>, keys: string[] = AFFECTED) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] }))),
  });
}

export const useEditOne = () =>
  useWrite(({ id, edit }: { id: number; edit: TransactionEdit }) => send<{ ok: true }>("PATCH", `/api/transactions/${id}`, edit));
export const useBulkEdit = () => useWrite((body: BulkEditRequest) => send<UpdatedResponse>("POST", "/api/transactions/bulk-edit", body));
export const useDelete = () => useWrite((ids: number[]) => send<DeletedResponse>("POST", "/api/transactions/delete", { ids }));
export const useRestore = () => useWrite((ids: number[]) => send<RestoredResponse>("POST", "/api/transactions/restore", { ids }));
export const useTag = () => useWrite((body: TagRequest) => send<TaggedResponse>("POST", "/api/transactions/tags", body));
