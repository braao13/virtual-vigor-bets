import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Trophy, Wallet, ListChecks, LogOut, Rabbit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/hooks/use-auth";
import { formatMoney } from "@/utils/formatters";

const nav = [
  { to: "/", label: "Início", icon: Home },
  { to: "/my-bets", label: "Minhas Apostas", icon: ListChecks },
  { to: "/wallet", label: "Carteira", icon: Wallet },
];

export function AppSidebar({ profile }: { profile: Profile | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2 px-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground glow-primary">
          <Rabbit className="h-5 w-5" />
        </div>
        <div>
          <p className="text-base font-bold leading-none">CoelhoBet</p>
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

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
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
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
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
  const items = [
    { to: "/", label: "Início", icon: Home },
    { to: "/my-bets", label: "Apostas", icon: Trophy },
    { to: "/wallet", label: "Carteira", icon: Wallet },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-sidebar">
      <div className="grid grid-cols-3">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
