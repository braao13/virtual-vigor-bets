import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Trophy, Wallet, ListChecks, LogOut, Rabbit, Bell, ShieldCheck, Crown, Users, User, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/hooks/use-auth";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/utils/formatters";

const nav = [
  { to: "/",              label: "Início",         icon: Home },
  { to: "/my-bets",       label: "Minhas Apostas", icon: ListChecks },
  { to: "/rankings",      label: "Rankings",       icon: Crown },
  { to: "/leagues",       label: "Ligas",          icon: Users },
  { to: "/wallet",        label: "Carteira",       icon: Wallet },
  { to: "/profile",       label: "Perfil",         icon: User },
  { to: "/notifications", label: "Notificações",   icon: Bell },
];

function useUnreadCount() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["notifications-unread", user?.id],
    enabled: !!user,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("is_read", false);
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data ?? 0;
}

export function AppSidebar({ profile }: { profile: Profile | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = useUnreadCount();

  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground glow-primary">
          <Rabbit className="h-5 w-5" />
        </div>
        <div>
          <p className="text-base font-bold leading-none">Rabbet</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bolão Virtual</p>
        </div>
      </div>

      <div className="px-4 py-4 border-b border-sidebar-border">
        <p className="text-xs text-muted-foreground">Saldo virtual</p>
        <p className="mt-1 text-2xl font-bold text-primary tabular-nums">
          {formatMoney(profile?.balance ?? 0)}
        </p>
        {profile && (
          <p className="mt-1 text-xs text-muted-foreground truncate">@{profile.username}</p>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          const showBadge = item.to === "/notifications" && unread > 0;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground"
              }`}
            >
              <span className="relative shrink-0">
                <Icon className="h-4 w-4" />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {item.label}
              {showBadge && (
                <span className="ml-auto text-[10px] font-bold rounded-full bg-destructive text-white px-1.5 py-0.5">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}

        {/* Admin links */}
        <div className="pt-3 mt-3 border-t border-sidebar-border space-y-1">
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Admin</p>
          {[
            { to: "/admin/matches", label: "Partidas",     icon: ShieldCheck },
            { to: "/admin/resets",  label: "Reset Saldo",  icon: RefreshCw },
          ].map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"
                }`}>
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = useUnreadCount();
  const items = [
    { to: "/",         label: "Início",   icon: Home },
    { to: "/rankings", label: "Rankings", icon: Crown },
    { to: "/leagues",  label: "Ligas",    icon: Users },
    { to: "/my-bets",  label: "Apostas",  icon: Trophy },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-sidebar">
      <div className="grid grid-cols-4">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          const showBadge = it.to === "/notifications" && unread > 0;
          return (
            <Link key={it.to} to={it.to}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}>
              <span className="relative">
                <Icon className="h-5 w-5" />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
