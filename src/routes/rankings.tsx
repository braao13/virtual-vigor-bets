import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Crown, Medal, TrendingUp, Trophy, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/utils/formatters";

export const Route = createFileRoute("/rankings")({
  head: () => ({ meta: [{ title: "Rankings · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <RankingsPage />
    </AppShell>
  ),
});

type Tab = "global" | "weekly" | "monthly";

interface RankingRow {
  id: string;
  username: string;
  avatar_url: string | null;
  balance: number;
  total_bets: number;
  total_won: number;
  total_profit: number;
  win_rate: number;
  current_win_streak: number;
  best_win_streak: number;
  weekly_profit: number;
  weekly_wins: number;
  monthly_profit: number;
  monthly_wins: number;
}

function RankingsPage() {
  const [tab, setTab] = useState<Tab>("global");
  const { user } = useAuth();

  const { data: rankings, isLoading } = useQuery({
    queryKey: ["rankings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_rankings")
        .select("*");
      if (error) throw error;
      return (data ?? []) as RankingRow[];
    },
    staleTime: 1000 * 60 * 5,
  });

  const sorted = (() => {
    if (!rankings) return [];
    if (tab === "global") return [...rankings].sort((a, b) => b.balance - a.balance);
    if (tab === "weekly") return [...rankings].sort((a, b) => b.weekly_profit - a.weekly_profit);
    return [...rankings].sort((a, b) => b.monthly_profit - a.monthly_profit);
  })();

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "global", label: "Global", icon: <Trophy className="h-4 w-4" /> },
    { id: "weekly", label: "Semanal", icon: <TrendingUp className="h-4 w-4" /> },
    { id: "monthly", label: "Mensal", icon: <Medal className="h-4 w-4" /> },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-primary mb-1">
          <Crown className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-wider">Rankings</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold">Tabela de classificação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Atualizado automaticamente a cada liquidação de apostas.
        </p>
      </header>

      <div className="flex gap-1 p-1 rounded-xl bg-surface mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((row, idx) => (
            <RankingCard
              key={row.id}
              row={row}
              position={idx + 1}
              tab={tab}
              isCurrentUser={row.id === user?.id}
            />
          ))}
          {sorted.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Nenhum apostador ainda.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankingCard({
  row, position, tab, isCurrentUser,
}: {
  row: RankingRow; position: number; tab: Tab; isCurrentUser: boolean;
}) {
  const positionEl = (() => {
    if (position === 1) return <Crown className="h-5 w-5 text-yellow-400" />;
    if (position === 2) return <Medal className="h-5 w-5 text-slate-400" />;
    if (position === 3) return <Medal className="h-5 w-5 text-amber-600" />;
    return <span className="text-sm font-bold text-muted-foreground w-5 text-center">{position}</span>;
  })();

  const mainValue = (() => {
    if (tab === "global") return { label: "Saldo", value: formatCurrency(row.balance) };
    if (tab === "weekly") return { label: "Lucro semanal", value: formatCurrency(row.weekly_profit) };
    return { label: "Lucro mensal", value: formatCurrency(row.monthly_profit) };
  })();

  const secondaryValue = (() => {
    if (tab === "global") return `${row.win_rate}% acerto`;
    if (tab === "weekly") return `${row.weekly_wins} acertos`;
    return `${row.monthly_wins} acertos`;
  })();

  const profit = tab === "global" ? row.total_profit : tab === "weekly" ? row.weekly_profit : row.monthly_profit;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
      isCurrentUser ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:border-border/80"
    }`}>
      <div className="w-6 flex items-center justify-center shrink-0">{positionEl}</div>
      <div className="h-9 w-9 rounded-full bg-surface flex items-center justify-center shrink-0 overflow-hidden">
        {row.avatar_url ? (
          <img src={row.avatar_url} alt={row.username} className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-primary">{row.username.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{row.username}</span>
          {isCurrentUser && (
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Você</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{secondaryValue}</span>
      </div>
      <div className="text-right shrink-0">
        <div className="font-bold text-sm">{mainValue.value}</div>
        <div className={`text-xs font-medium ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
          {profit >= 0 ? "+" : ""}{formatCurrency(profit)}
        </div>
      </div>
    </div>
  );
}
