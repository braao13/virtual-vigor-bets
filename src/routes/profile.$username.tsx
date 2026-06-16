import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart2, CheckCircle2, TrendingUp, Trophy, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/utils/formatters";

export const Route = createFileRoute("/profile/$username")({
  head: ({ params }) => ({
    meta: [{ title: `${params.username} · Rabbet` }],
  }),
  component: () => (
    <AppShell>
      <PublicProfilePage />
    </AppShell>
  ),
});

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
  monthly_profit: number;
}

function PublicProfilePage() {
  const { username } = Route.useParams();
  const { user } = useAuth();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["public-profile", username],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_rankings")
        .select("id, username, avatar_url, balance, total_bets, total_won, total_profit, win_rate, current_win_streak, best_win_streak, weekly_profit, monthly_profit")
        .eq("username", username)
        .maybeSingle();
      if (error) throw error;
      return data as RankingRow | null;
    },
  });

  if (isLoading) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
        <div className="h-8 w-48 rounded bg-surface animate-pulse mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="px-4 py-16 text-center text-muted-foreground">
        <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Apostador não encontrado.</p>
        <Link to="/rankings" className="text-primary text-sm underline mt-2 inline-block">
          Ver rankings
        </Link>
      </div>
    );
  }

  const isOwnProfile = profile.id === user?.id;
  const winRate = typeof profile.win_rate === "number" ? profile.win_rate.toFixed(1) : "0.0";

  const stats = [
    {
      label: "Saldo",
      value: formatCurrency(profile.balance),
      icon: <TrendingUp className="h-5 w-5 text-primary" />,
    },
    {
      label: "Lucro total",
      value: formatCurrency(profile.total_profit),
      icon: <BarChart2 className="h-5 w-5 text-primary" />,
      colored: true,
      positive: profile.total_profit >= 0,
    },
    {
      label: "Total de apostas",
      value: String(profile.total_bets),
      icon: <Trophy className="h-5 w-5 text-primary" />,
    },
    {
      label: "Taxa de acerto",
      value: `${winRate}%`,
      icon: <CheckCircle2 className="h-5 w-5 text-primary" />,
    },
    {
      label: "Streak atual",
      value: `${profile.current_win_streak}🔥`,
      icon: <Zap className="h-5 w-5 text-primary" />,
    },
    {
      label: "Melhor streak",
      value: `${profile.best_win_streak}⭐`,
      icon: <Zap className="h-5 w-5 text-primary" />,
    },
    {
      label: "Lucro semanal",
      value: formatCurrency(profile.weekly_profit),
      icon: <TrendingUp className="h-5 w-5 text-primary" />,
      colored: true,
      positive: profile.weekly_profit >= 0,
    },
    {
      label: "Lucro mensal",
      value: formatCurrency(profile.monthly_profit),
      icon: <BarChart2 className="h-5 w-5 text-primary" />,
      colored: true,
      positive: profile.monthly_profit >= 0,
    },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <Link
        to="/rankings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Rankings
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="h-16 w-16 rounded-full bg-surface flex items-center justify-center overflow-hidden border-2 border-primary/30 shrink-0">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-primary">
              {profile.username.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{profile.username}</h1>
            {isOwnProfile && (
              <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                Você
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {profile.total_won} vitórias de {profile.total_bets} apostas
          </p>
          {isOwnProfile && (
            <Link to="/profile" className="text-xs text-primary hover:underline mt-1 inline-block">
              Ver perfil completo →
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <h2 className="text-lg font-bold mb-3">Estatísticas</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="p-4 rounded-xl border border-border bg-card">
            <div className="mb-2">{s.icon}</div>
            <div
              className={`text-xl font-bold ${
                s.colored
                  ? s.positive
                    ? "text-primary"
                    : "text-destructive"
                  : "text-foreground"
              }`}
            >
              {s.value}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
