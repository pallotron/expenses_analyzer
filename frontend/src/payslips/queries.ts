import { useQuery } from "@tanstack/react-query";
import { getJson, send } from "../lib/api";
import type {
  PayslipImportRequest, PayslipImportResponse, PayslipRemoveRequest, PayslipRemoveResponse, PayslipsResponse,
} from "../lib/types";
import { useWrite } from "../transactions/edit/mutations";

export const usePayslips = () =>
  useQuery({ queryKey: ["payslips"], queryFn: () => getJson<PayslipsResponse>("/api/payslips") });

export const useImportPayslips = () =>
  useWrite((body: PayslipImportRequest) => send<PayslipImportResponse>("POST", "/api/payslips/import", body), ["payslips", "summary"]);

export const useRemovePayslips = () =>
  useWrite((body: PayslipRemoveRequest) => send<PayslipRemoveResponse>("POST", "/api/payslips/remove", body), ["payslips", "summary"]);
