import { ImportPage } from "./import/ImportPage";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";

import { AccountsPage } from "./accounts/AccountsPage";
import { BudgetsPage } from "./budgets/BudgetsPage";
import { createQueryClient } from "./lib/queryClient";
import { PayslipsPage } from "./payslips/PayslipsPage";
import { MerchantsPage } from "./merchants/MerchantsPage";
import { SummaryPage } from "./summary/SummaryPage";
import { TransactionsPage } from "./transactions/TransactionsPage";
import { TopBar } from "./TopBar";

const queryClient = createQueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TopBar />
        <Routes>
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/merchants" element={<MerchantsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/payslips" element={<PayslipsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="*" element={<SummaryPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
