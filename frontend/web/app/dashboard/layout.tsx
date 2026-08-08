"use client";

import {
  Inbox,
  Bot,
  BookOpen,
  BarChart3,
  Palette,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Check,
  ArrowLeftRight,
  Bell,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { teamsApi, type UserOrg } from "@/lib/teams-service";
import { storeUser, updatePresence } from "@/lib/auth-service";
import { NotificationBell } from "@/components/notification-bell";

const navItems = [
  { icon: Inbox, label: "Inbox", href: "/dashboard/inbox", minRole: "agent" },
  { icon: Bot, label: "AI", href: "/dashboard/ai", minRole: "admin" },
  { icon: BookOpen, label: "Knowledge", href: "/dashboard/knowledge", minRole: "admin" },
  { icon: BarChart3, label: "Insights", href: "/dashboard/insights", minRole: "admin" },
  { icon: Palette, label: "Widget", href: "/dashboard/widget", minRole: "admin" },
  { icon: Users, label: "Teams", href: "/dashboard/teams", minRole: "agent" },
];

const roleHierarchy: Record<string, number> = { agent: 0, admin: 1, owner: 2 };

function hasAccess(userRole: string, minRole: string): boolean {
  return (roleHierarchy[userRole] || 0) >= (roleHierarchy[minRole] || 0);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [orgs, setOrgs] = useState<UserOrg[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [online, setOnline] = useState(true);
  const [presenceSaving, setPresenceSaving] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) setOnline(Boolean(user.is_online));
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/signin");
      return;
    }
    if (!user.organization && pathname !== "/dashboard/workspace-setup") {
      router.push("/dashboard/workspace-setup");
    }
    // Role-based page access control
    const restrictedItem = navItems.find((item) => pathname?.startsWith(item.href));
    if (restrictedItem && !hasAccess(user.role, restrictedItem.minRole)) {
      router.push("/dashboard/inbox");
    }
  }, [user, loading, router, pathname]);

  useEffect(() => {
    if (!user) return;
    teamsApi.getUserOrgs().then(setOrgs).catch(() => {});
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitchOrg = async (orgId: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      const newOrg = await teamsApi.switchOrg(orgId);
      if (user) {
        const updatedUser = { ...user, organization: newOrg };
        storeUser(updatedUser);
        window.location.reload();
      }
    } catch {
    } finally {
      setSwitching(false);
      setOrgMenuOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  const initials = user.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  const currentOrg = user.organization;
  const currentOrgInitials = currentOrg?.name
    ? currentOrg.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "C";

  const handleLogout = async () => {
    await logout();
    router.push("/signin");
  };

  const handlePresenceToggle = async (next: boolean) => {
    const prev = online;
    setOnline(next);
    setPresenceSaving(true);
    try {
      const updated = await updatePresence(next);
      if (user) storeUser({ ...user, is_online: updated.is_online });
    } catch {
      setOnline(prev);
    } finally {
      setPresenceSaving(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex md:shrink-0 md:flex-col md:bg-background md:transition-all md:duration-200 ${
          sidebarExpanded ? "md:w-56" : "md:w-16"
        }`}
      >
        {/* Top: Logo / Collapse button */}
        <div className="flex items-center h-12 px-3 shrink-0">
          {sidebarExpanded ? (
            <button
              onClick={() => setSidebarExpanded(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={() => setSidebarExpanded(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-sm font-bold text-primary-foreground hover:opacity-90"
              title="Expand sidebar"
            >
              {currentOrgInitials}
            </button>
          )}
        </div>

        {/* Org switcher (expanded only) */}
        {sidebarExpanded && (
          <div className="px-3 mb-2">
            <div className="relative" ref={orgMenuRef}>
              <button
                onClick={() => setOrgMenuOpen(!orgMenuOpen)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="text-xs font-medium text-ink truncate flex-1">
                  {currentOrg?.name || "Connect"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>

              {orgMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-border bg-card p-1.5 shadow-lg">
                  <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Workspaces
                  </div>
                  {orgs.map((org) => {
                    const isCurrent = org.id === currentOrg?.id;
                    return (
                    <button
                      key={org.id}
                      onClick={() => handleSwitchOrg(org.id)}
                      disabled={switching}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                        isCurrent
                          ? "bg-ink text-primary-foreground"
                          : "text-ink hover:bg-surface-2"
                      }`}
                    >
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                        isCurrent
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-surface text-ink"
                      }`}>
                        {org.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                      <div className="flex flex-1 min-w-0 flex-col">
                        <span className="text-xs font-medium truncate">{org.name}</span>
                        <span className={`text-[10px] capitalize ${isCurrent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {org.role === "owner" ? "Owner" : "Member"}
                        </span>
                      </div>
                      {isCurrent && (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      )}
                    </button>
                    );
                  })}
                  <div className="mt-1 border-t border-border pt-1">
                    <button
                      onClick={() => {
                        setOrgMenuOpen(false);
                        router.push("/dashboard/workspace-setup");
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      Create new workspace
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Nav items */}
        <nav className={`flex flex-1 flex-col gap-1 px-3 ${sidebarExpanded ? "" : "items-center"}`}>
          {navItems
            .filter((item) => hasAccess(user.role, item.minRole))
            .map(({ icon: Icon, label, href }) => {
            const isActive = pathname === href || pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`flex h-10 items-center gap-3 rounded-lg transition-colors ${
                  sidebarExpanded ? "w-full px-3" : "w-10 justify-center"
                } ${
                  isActive
                    ? "bg-ink text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {label === "AI" ? (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
                    <img src={isActive ? "/KAI_White.png" : "/KAI_Logo.png"} alt="Kai" className="h-5 w-5 object-contain" />
                  </div>
                ) : (
                  <Icon className="h-5 w-5 shrink-0" />
                )}
                {sidebarExpanded && (
                  <span className="text-sm font-medium">{label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: Settings + Profile */}
        <div className={`flex flex-col gap-1 px-3 pb-3 ${sidebarExpanded ? "" : "items-center"}`}>
          <Link
            href="/dashboard/settings"
            title="Settings"
            className={`flex h-10 items-center gap-3 rounded-lg transition-colors ${
              sidebarExpanded ? "w-full px-3" : "w-10 justify-center"
            } ${
              pathname === "/dashboard/settings"
                ? "bg-ink text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Settings className="h-5 w-5 shrink-0" />
            {sidebarExpanded && <span className="text-sm font-medium">Settings</span>}
          </Link>

          <div className={`flex items-center ${sidebarExpanded ? "gap-1" : "flex-col gap-1"}`}>
            <NotificationBell />
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className={`flex h-10 items-center gap-3 overflow-hidden rounded-full transition-colors hover:bg-surface-2 ${
                  sidebarExpanded ? "w-full px-2" : "w-10 justify-center"
                }`}
              >
                <div className="relative">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-medium text-accent-foreground">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : initials}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-background ${
                      online ? "bg-emerald-500" : "bg-muted-foreground/70"
                    }`}
                  />
                </div>
                {sidebarExpanded && (
                  <span className="text-xs font-medium text-ink truncate">{user.name || user.email}</span>
                )}
              </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
              <div className="absolute left-full bottom-0 z-20 ml-2 w-52 rounded-lg border border-border bg-card p-3 shadow-lg">
                <div className="border-b border-border pb-2 mb-2">
                  <p className="text-xs font-semibold text-ink">{user.name}</p>
                  <p className="text-[10px] text-muted-foreground">{user.email}</p>
                </div>
                <div className="mb-2">
                  <p className="pb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </p>
                  <button
                    onClick={() => handlePresenceToggle(!online)}
                    disabled={presenceSaving}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                      online ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-surface-2"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs font-medium text-ink">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          online ? "bg-emerald-500" : "bg-muted-foreground/70"
                        }`}
                      />
                      {online ? "Online" : "Offline"}
                    </span>
                    <span
                      className={`relative h-4 w-7 rounded-full transition-colors ${
                        online ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                          online ? "left-3.5" : "left-0.5"
                        }`}
                      />
                    </span>
                  </button>
                  <p className="pt-1.5 text-[10px] leading-snug text-muted-foreground">
                    Offline agents are skipped when Kai auto-assigns conversations.
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Log out
                </button>
              </div>
            </>
          )}
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex md:hidden shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <button onClick={() => setMobileMenuOpen(true)} className="rounded-lg p-1.5 text-ink hover:bg-surface-2">
          <Menu className="h-6 w-6" />
        </button>
        <Link href="/dashboard/inbox" className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">
          {currentOrgInitials}
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-medium text-accent-foreground"
          >
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : initials}
            <span
              className={`absolute bottom-0 right-0 h-2 w-2 rounded-full ring-2 ring-card ${
                online ? "bg-emerald-500" : "bg-muted-foreground/70"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-64 bg-card p-4 shadow-lg md:hidden">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-xs font-bold text-white">{currentOrgInitials}</div>
                <span className="text-sm font-semibold text-ink">{currentOrg?.name || "Connect"}</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {orgs.length > 1 && (
              <div className="mb-4">
                <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Workspaces
                </div>
                {orgs.map((org) => {
                  const isCurrent = org.id === currentOrg?.id;
                  return (
                  <button
                    key={org.id}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleSwitchOrg(org.id);
                    }}
                    disabled={switching}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isCurrent
                        ? "bg-ink text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    }`}
                  >
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                      isCurrent
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-surface text-ink"
                    }`}>
                      {org.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div className="flex flex-1 min-w-0 flex-col">
                      <span className="truncate">{org.name}</span>
                      <span className={`text-[10px] capitalize ${isCurrent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {org.role === "owner" ? "Owner" : "Member"}
                      </span>
                    </div>
                    {isCurrent && (
                      <Check className="h-3.5 w-3.5 shrink-0 ml-auto" />
                    )}
                  </button>
                  );
                })}
                <div className="my-2 border-t border-border" />
              </div>
            )}

            <nav className="space-y-1">
              {navItems
                .filter((item) => hasAccess(user.role, item.minRole))
                .map(({ icon: Icon, label, href }) => {
                const isActive = pathname === href || pathname?.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? "bg-ink text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {label}
                  </Link>
                );
              })}
              <div className="my-3 border-t border-border" />
              <Link
                href="/dashboard/settings"
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  pathname === "/dashboard/settings"
                    ? "bg-ink text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Settings className="h-5 w-5 shrink-0" />
                Settings
              </Link>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                Log out
              </button>
            </nav>
          </div>
        </>
      )}

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-border bg-card px-2 py-1.5 md:hidden">
        {navItems
          .filter((item) => hasAccess(user.role, item.minRole))
          .slice(0, 5)
          .map(({ icon: Icon, label, href }) => {
          const isActive = pathname === href || pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                isActive
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
        {navItems.filter((item) => hasAccess(user.role, item.minRole)).length > 5 && (
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
            <span className="leading-none">More</span>
          </button>
        )}
      </nav>

      <main className="flex flex-1 flex-col overflow-hidden pb-12 md:pb-0">
        {children}
      </main>
    </div>
  );
}
