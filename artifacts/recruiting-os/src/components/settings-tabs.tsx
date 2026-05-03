import { Link, useLocation } from "wouter";
import { Cpu, Mail, Bell } from "lucide-react";

const TABS = [
  { href: "/settings/providers", label: "Agent Providers", icon: Cpu },
  { href: "/settings/email-revalidation", label: "Email Re-checks", icon: Mail },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
];

export function SettingsTabs() {
  const [location] = useLocation();
  return (
    <nav className="flex items-center gap-1 border-b border-border px-8 pt-4">
      {TABS.map((tab) => {
        const active = location.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href}>
            <div
              className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-b-2 -mb-px ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`settings-tab-${tab.href.split("/").pop()}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
