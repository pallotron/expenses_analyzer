import { ImportAction } from "./import/ImportAction";
import { ImportPage } from "./import/ImportPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";

import { ApiError } from "./lib/api";
import { MerchantsPage } from "./merchants/MerchantsPage";
import { SummaryPage } from "./summary/SummaryPage";
import { TransactionsPage } from "./transactions/TransactionsPage";
import { TopBar } from "./TopBar";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500) } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TopBar />
        <Routes>
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/merchants" element={<MerchantsPage />} />
          <Route path="/import" element={<ImportPage renderAction={(ready, reset) => <ImportAction ready={ready} onReset={reset} />} />} />
          <Route path="*" element={<SummaryPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
