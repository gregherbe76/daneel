import { Link, useLocation } from "wouter";
import { Briefcase, Users, PlayCircle, ListChecks } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "Jobs", href: "/jobs", icon: Briefcase },
    { name: "Candidates", href: "/candidates", icon: Users },
    { 
      name: "Workflow", 
      href: "/jobs", 
      icon: PlayCircle, 
      caption: "Run AI on a job",
      match: "__never__" 
    },
    { 
      name: "Shortlist", 
      href: "/jobs", 
      icon: ListChecks, 
      caption: "View top candidates",
      match: "__never__"
    },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shrink-0">
              <span className="text-primary-foreground font-bold text-sm">H</span>
            </div>
            <h1 className="text-xl font-bold text-sidebar-foreground tracking-tight">
              HireFlow
            </h1>
          </div>
          <p className="text-[11px] text-sidebar-foreground/50 mt-2">AI hiring workflow platform for teams</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = item.match 
              ? location === item.match
              : location.startsWith(item.href);
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
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    {item.caption && (
                      <span className="text-[10px] opacity-50 font-normal">{item.caption}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
