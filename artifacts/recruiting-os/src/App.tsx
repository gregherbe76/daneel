import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { PendingRunsWatcher } from "@/lib/pending-runs";
import { useBranding } from "@/lib/branding";
import { applyBrandTheme } from "@/lib/apply-brand";
import { BulkJobsTracker } from "@/lib/bulk-jobs-tracker";
import { TelemetryConsentBanner } from "@/components/telemetry-consent-banner";

// Pages
import LandingPage from "./pages/landing";
import JobsPage from "./pages/jobs/index";
import CreateJobPage from "./pages/jobs/new";
import EditJobPage from "./pages/jobs/edit";
import JobDetailPage from "./pages/jobs/detail";
import JobReportPage from "./pages/jobs/report";
import CandidatesPage from "./pages/candidates/index";
import CandidateDetailPage from "./pages/candidates/detail";
import AgentProvidersPage from "./pages/settings/providers";
import EmailRevalidationSettingsPage from "./pages/settings/email-revalidation";
import BrandingSettingsPage from "./pages/settings/branding";
import NotificationsSettingsPage from "./pages/settings/notifications";
import TelemetrySettingsPage from "./pages/settings/telemetry";
import MentionsPage from "./pages/mentions";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/jobs" component={JobsPage} />
        <Route path="/jobs/new" component={CreateJobPage} />
        <Route path="/jobs/:id/report" component={JobReportPage} />
        <Route path="/jobs/:id" component={JobDetailPage} />
        <Route path="/jobs/:id/edit" component={EditJobPage} />
        <Route path="/candidates" component={CandidatesPage} />
        <Route path="/candidates/new" component={() => <div className="p-8">Candidate Create (WIP)</div>} />
        <Route path="/candidates/:id" component={CandidateDetailPage} />
        <Route path="/candidates/:id/edit" component={() => <div className="p-8">Candidate Edit (WIP)</div>} />
        <Route path="/pipeline" component={() => <div className="p-8">Pipeline (WIP)</div>} />
        <Route path="/mentions" component={MentionsPage} />
        <Route path="/settings" component={() => <Redirect to="/settings/providers" />} />
        <Route path="/settings/providers" component={AgentProvidersPage} />
        <Route path="/settings/email-revalidation" component={EmailRevalidationSettingsPage} />
        <Route path="/settings/branding" component={BrandingSettingsPage} />
        <Route path="/settings/notifications" component={NotificationsSettingsPage} />
        <Route path="/settings/telemetry" component={TelemetrySettingsPage} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

/**
 * Pulls the resolved runtime brand colors and re-applies them to the live
 * CSS custom properties. The first paint already shows the static template
 * defaults (seeded from main.tsx), so this is purely an upgrade-in-place
 * once the saved overrides arrive — no flash.
 */
function BrandThemeApplier() {
  const branding = useBranding();
  useEffect(() => {
    applyBrandTheme({ primary: branding.colors.primary, accent: branding.colors.accent });
  }, [branding.colors.primary, branding.colors.accent]);
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <BrandThemeApplier />
          <PendingRunsWatcher />
          <BulkJobsTracker />
          <TelemetryConsentBanner />
          <Switch>
            <Route path="/" component={LandingPage} />
            <Route component={AppRoutes} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
