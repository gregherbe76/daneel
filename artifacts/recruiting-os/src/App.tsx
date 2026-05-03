import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

// Pages
import JobsPage from "./pages/jobs/index";
import CreateJobPage from "./pages/jobs/new";
import JobDetailPage from "./pages/jobs/detail";
import JobReportPage from "./pages/jobs/report";
import CandidatesPage from "./pages/candidates/index";
import AgentProvidersPage from "./pages/settings/providers";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <Redirect to="/jobs" />} />
        <Route path="/jobs" component={JobsPage} />
        <Route path="/jobs/new" component={CreateJobPage} />
        <Route path="/jobs/:id/report" component={JobReportPage} />
        <Route path="/jobs/:id" component={JobDetailPage} />
        <Route path="/jobs/:id/edit" component={() => <div className="p-8">Client Mission Edit (WIP)</div>} />
        <Route path="/candidates" component={CandidatesPage} />
        <Route path="/candidates/new" component={() => <div className="p-8">Candidate Create (WIP)</div>} />
        <Route path="/candidates/:id" component={() => <div className="p-8">Candidate Detail (WIP)</div>} />
        <Route path="/candidates/:id/edit" component={() => <div className="p-8">Candidate Edit (WIP)</div>} />
        <Route path="/pipeline" component={() => <div className="p-8">Pipeline (WIP)</div>} />
        <Route path="/settings" component={() => <Redirect to="/settings/providers" />} />
        <Route path="/settings/providers" component={AgentProvidersPage} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
