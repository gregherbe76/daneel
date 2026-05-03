import { Link, useLocation } from "wouter";
import { Briefcase, Users, PlayCircle, ListChecks, AtSign } from "lucide-react";
import {
  useListTeamMembers,
  useListMentionsForMember,
} from "@workspace/api-client-react";
import { useCurrentUser, useMentionsLastRead } from "@/lib/current-user";

function MentionsBadge() {
  const teamQuery = useListTeamMembers();
  const user = useCurrentUser(teamQuery.data);
  const userId = user?.id ?? "";
  const [lastRead] = useMentionsLastRead(userId);

  const mentionsQuery = useListMentionsForMember(userId, undefined, {
    query: {
      queryKey: ["mentions", userId],
      enabled: Boolean(userId),
      refetchInterval: 15000,
    },
  });
  const items = mentionsQuery.data ?? [];

  const unread = items.filter((m) => {
    const iso =
      typeof m.comment.createdAt === "string"
        ? m.comment.createdAt
        : new Date(m.comment.createdAt).toISOString();
    return !lastRead || new Date(iso) > new Date(lastRead);
  }).length;

  if (unread === 0) return null;
  return (
    <span
      data-testid="mentions-badge"
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold"
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation: Array<{
    name: string;
    href: string;
    icon: typeof Briefcase;
    caption?: string;
    match?: string;
    badge?: React.ReactNode;
  }> = [
    { name: "Jobs", href: "/jobs", icon: Briefcase },
    { name: "Candidates", href: "/candidates", icon: Users },
    { name: "Mentions", href: "/mentions", icon: AtSign, badge: <MentionsBadge /> },
    {
      name: "Workflow",
      href: "/jobs",
      icon: PlayCircle,
      caption: "Run AI on a job",
      match: "__never__",
    },
    {
      name: "Shortlist",
      href: "/jobs",
      icon: ListChecks,
      caption: "View top candidates",
      match: "__never__",
    },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-[#F97316] flex items-center justify-center shrink-0 relative">
              <svg viewBox="0 0 180 180" className="h-5 w-5" aria-hidden="true">
                <path d="M52 46 V134" stroke="white" strokeWidth="14" strokeLinecap="round" />
                <path d="M114 46 V134" stroke="white" strokeWidth="14" strokeLinecap="round" />
                <path d="M52 90 H114" stroke="white" strokeWidth="14" strokeLinecap="round" />
                <circle cx="138" cy="48" r="12" fill="white" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-sidebar-foreground tracking-tight">
              HiringAI
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
                  <div className="flex flex-col flex-1">
                    <span>{item.name}</span>
                    {item.caption && (
                      <span className="text-[10px] opacity-50 font-normal">{item.caption}</span>
                    )}
                  </div>
                  {item.badge}
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
