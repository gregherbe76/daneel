import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { template } from "@workspace/branding";
import { useBranding } from "@/lib/branding";

export default function LandingPage() {
  const branding = useBranding();
  const initial = branding.productName.charAt(0);
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center"
            style={{ backgroundColor: branding.colors.accent }}
          >
            <span className="text-white font-bold text-sm">{initial}</span>
          </div>
          <span className="text-lg font-semibold tracking-tight">{branding.productName}</span>
        </div>
        <Link
          href="/jobs"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center">
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
            Make better hiring
            <br />
            decisions, faster.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground">
            No ATS. No complexity. Just decisions.
          </p>

          <div className="mt-10 flex items-center justify-center">
            <Link
              href="/jobs"
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-6 py-3 text-base font-medium hover:opacity-90 transition-opacity"
            >
              Start hiring
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <p className="mt-8 text-sm text-muted-foreground/80">
            Built for {template.primaryUserPlural}.
          </p>
        </div>
      </main>

      <footer className="px-8 py-8 border-t border-border">
        <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto">
          Built on an agentic recruiting engine. {branding.productName} is powered by{" "}
          <a
            href="https://github.com/emcie-co/daneel"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            Daneel
          </a>
          , an open-source agentic recruiting OS.
        </p>
      </footer>
    </div>
  );
}
