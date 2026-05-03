import { Link, useLocation } from "wouter";
import { Briefcase, Users, LayoutDashboard, Settings } from "lucide-react";
import { LogoMark } from "./logo-mark";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "Client Missions", href: "/jobs", icon: Briefcase },
    { name: "Candidates", href: "/candidates", icon: Users },
  ];

  const settingsNavigation = [
    { name: "Advanced", href: "/settings/providers", icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8 rounded-md shrink-0" />
            <h1 className="text-xl font-bold text-sidebar-foreground tracking-tight">
              Shortlist<span className="text-[#FF3C00]">Pro</span>
            </h1>
          </div>
          <p className="text-[11px] text-sidebar-foreground/50 mt-2">AI shortlist engine for agencies</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border space-y-1">
          <p className="px-3 pb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/40">
            Powered by Daneel
          </p>
          {settingsNavigation.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
