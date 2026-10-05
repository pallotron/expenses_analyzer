import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type { SourceOwnerRequest, SourceOwnersResponse } from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

export const useSourceOwners = () =>
  useQuery({ queryKey: ["source-owners"], queryFn: () => getJson<SourceOwnersResponse>("/api/source-owners") });

export const useSetSourceOwner = () =>
  useWrite((body: SourceOwnerRequest) => send<{ ok: true }>("POST", "/api/source-owners", body), ["source-owners", "summary"]);
