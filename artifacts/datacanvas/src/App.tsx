import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import DatasetOverview from "@/pages/dataset-overview";
import EdaExplorer from "@/pages/eda-explorer";
import ColumnDeepDive from "@/pages/column-deep-dive";
import CorrelationMatrix from "@/pages/correlation-matrix";
import OutlierDetection from "@/pages/outlier-detection";
import AiSnapshot from "@/pages/ai-snapshot";
import QueryBuilder from "@/pages/query-builder";
import ExportCenter from "@/pages/export-center";
import { Layout } from "@/components/layout";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/datasets/:id" component={DatasetOverview} />
        <Route path="/datasets/:id/eda" component={EdaExplorer} />
        <Route path="/datasets/:id/columns/:column" component={ColumnDeepDive} />
        <Route path="/datasets/:id/correlation" component={CorrelationMatrix} />
        <Route path="/datasets/:id/outliers" component={OutlierDetection} />
        <Route path="/datasets/:id/ai" component={AiSnapshot} />
        <Route path="/datasets/:id/query" component={QueryBuilder} />
        <Route path="/datasets/:id/export" component={ExportCenter} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
