import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, CheckCircle2, Clock, TrendingUp, Trophy, XCircle, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Perfil · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <ProfilePage />
    </AppShell>
  ),
});

interface Profile {
  id: string; username: string; email: string; avatar_url: string | null;
  balance: number; total_bets: number; total_won: number; total_profit: number;
  current_win_streak: number; best_win_streak: number;
}
interface Bet {
  id: string; bet_type: string; stake: number; total_odds: number;
  potential_return: number; actual_return: number | null;
  status: string; created_at: string; selections_count: number;
}

function ProfilePage() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });

  const { data: bets } = useQuery({
    queryKey: ["profile-bets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("bets").select("*")
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as Bet[];
    },
  });

  if (!profile) return null;

  const winRate = profile.total_bets > 0 ? ((profile.total_won / profile.total_bets) * 100).toFixed(1) : "0.0";
  const roi = (() => {
    if (!bets || profile.total_bets === 0) return "0.0";
    const totalStaked = bets.filter((b) => b.status !== "pending").reduce((s, b) => s + b.stake, 0);
    return totalStaked > 0 ? ((profile.total_profit / totalStaked) * 100).toFixed(1) : "0.0";
  })();
  const avgOdds = bets && bets.length > 0
    ? (bets.reduce((s, b) => s + b.total_odds, 0) / bets.length).toFixed(2) : "0.00";

  const stats = [
    { label: "Saldo atual", value: formatCurrency(profile.balance), icon: <TrendingUp className="h-5 w-5 text-primary" />, highlight: true },
    { label: "Lucro total", value: formatCurrency(profile.total_profit), icon: <BarChart2 className="h-5 w-5 text-primary" />, positive: profile.total_profit >= 0 },
    { label: "ROI", value: `${roi}%`, icon: <TrendingUp className="h-5 w-5 text-primary" /> },
    { label: "Taxa de acerto", value: `${winRate}%`, icon: <CheckCircle2 className="h-5 w-5 text-primary" /> },
    { label: "Total de apostas", value: String(profile.total_bets), icon: <Trophy className="h-5 w-5 text-primary" /> },
    { label: "Streak atual", value: `${profile.current_win_streak}🔥`, icon: <Zap className="h-5 w-5 text-primary" /> },
    { label: "Melhor streak", value: `${profile.best_win_streak}⭐`, icon: <Zap className="h-5 w-5 text-primary" /> },
    { label: "Odd média", value: avgOdds, icon: <BarChart2 className="h-5 w-5 text-primary" /> },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="h-16 w-16 rounded-full bg-surface flex items-center justify-center overflow-hidden border-2 border-primary/30">
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
            : <span className="text-2xl font-bold text-primary">{profile.username.charAt(0).toUpperCase()}</span>}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{profile.username}</h1>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      <h2 className="text-lg font-bold mb-3">Estatísticas</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="p-4 rounded-xl border border-border bg-card">
            <div className="mb-2">{s.icon}</div>
            <div className={`text-xl font-bold ${"positive" in s ? (s.positive ? "text-primary" : "text-destructive") : "text-foreground"}`}>
              {s.value}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-3">Histórico recente</h2>
      <div className="space-y-2">
        {(bets ?? []).map((bet) => <BetHistoryRow key={bet.id} bet={bet} />)}
        {bets?.length === 0 && <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma aposta ainda.</div>}
      </div>
    </div>
  );
}

function BetHistoryRow({ bet }: { bet: Bet }) {
  const statusConfig = {
    pending:   { icon: <Clock className="h-4 w-4 text-warning" />,            label: "Pendente",   color: "text-warning" },
    won:       { icon: <CheckCircle2 className="h-4 w-4 text-primary" />,     label: "Ganha",      color: "text-primary" },
    lost:      { icon: <XCircle className="h-4 w-4 text-destructive" />,      label: "Perdida",    color: "text-destructive" },
    void:      { icon: <Clock className="h-4 w-4 text-muted-foreground" />,   label: "Anulada",    color: "text-muted-foreground" },
    cancelled: { icon: <XCircle className="h-4 w-4 text-muted-foreground" />, label: "Cancelada",  color: "text-muted-foreground" },
  };
  const cfg = statusConfig[bet.status as keyof typeof statusConfig] ?? statusConfig.pending;
  const profit = bet.actual_return != null ? bet.actual_return - bet.stake : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card">
      <div className="shrink-0">{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{bet.bet_type === "single" ? "Simples" : `Múltipla (${bet.selections_count})`}</span>
          <span className="text-xs text-muted-foreground">@ {bet.total_odds.toFixed(2)}</span>
        </div>
        <span className="text-xs text-muted-foreground">{formatMatchDate(bet.created_at)}</span>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold">{formatCurrency(bet.stake)}</div>
        {profit != null && (
          <div className={`text-xs font-medium ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
            {profit >= 0 ? "+" : ""}{formatCurrency(profit)}
          </div>
        )}
        {bet.status === "pending" && (
          <div className="text-xs text-muted-foreground">ret. {formatCurrency(bet.potential_return)}</div>
        )}
      </div>
    </div>
  );
}
