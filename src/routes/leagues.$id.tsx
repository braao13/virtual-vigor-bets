import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Crown, Medal, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/utils/formatters";

export const Route = createFileRoute("/leagues/$id")({
  head: () => ({ meta: [{ title: "Liga · Rabbet" }] }),
  component: () => (
    <AppShell>
      <LeagueDetailPage />
    </AppShell>
  ),
});

interface LeagueMember {
  user_id: string;
  role: string;
  joined_at: string;
  profiles: {
    username: string;
    avatar_url: string | null;
    balance: number;
    total_bets: number;
    total_won: number;
    total_profit: number;
    current_win_streak: number;
  };
}

interface League {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  max_members: number;
}

function LeagueDetailPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();

  const { data: league, isLoading: loadingLeague } = useQuery({
    queryKey: ["league", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("leagues").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as League | null;
    },
  });

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ["league-members", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("league_members")
        .select("user_id, role, joined_at, profiles (username, avatar_url, balance, total_bets, total_won, total_profit, current_win_streak)")
        .eq("league_id", id)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeagueMember[];
    },
  });

  const sorted = [...(members ?? [])].sort((a, b) => b.profiles.balance - a.profiles.balance);
  const copyCode = () => { if (!league) return; navigator.clipboard.writeText(league.invite_code); toast.success("Código copiado!"); };

  if (loadingLeague) {
    return (
      <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
        <div className="h-8 w-48 rounded bg-surface animate-pulse mb-4" />
        <div className="h-4 w-64 rounded bg-surface animate-pulse" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground">
        Liga não encontrada.{" "}
        <Link to="/leagues" className="text-primary underline">Voltar</Link>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <Link to="/leagues" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Minhas ligas
      </Link>

      <div className="p-5 rounded-2xl border border-border bg-card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{league.name}</h1>
            {league.description && <p className="text-sm text-muted-foreground mt-1">{league.description}</p>}
            <div className="flex items-center gap-2 mt-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{sorted.length} / {league.max_members} membros</span>
            </div>
          </div>
          <button onClick={copyCode}
            className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-surface hover:bg-border transition-colors shrink-0">
            <Copy className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-mono font-bold tracking-widest text-primary">{league.invite_code}</span>
            <span className="text-[10px] text-muted-foreground">Copiar código</span>
          </button>
        </div>
      </div>

      <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
        <Crown className="h-5 w-5 text-yellow-400" />
        Classificação da liga
      </h2>

      {loadingMembers ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((member, idx) => {
            const p = member.profiles;
            const isMe = member.user_id === user?.id;
            const winRate = p.total_bets > 0 ? Math.round((p.total_won / p.total_bets) * 100) : 0;
            const positionEl = (() => {
              if (idx === 0) return <Crown className="h-5 w-5 text-yellow-400" />;
              if (idx === 1) return <Medal className="h-5 w-5 text-slate-400" />;
              if (idx === 2) return <Medal className="h-5 w-5 text-amber-600" />;
              return <span className="text-sm font-bold text-muted-foreground w-5 text-center">{idx + 1}</span>;
            })();
            return (
              <div key={member.user_id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${isMe ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
                <div className="w-6 flex items-center justify-center shrink-0">{positionEl}</div>
                <div className="h-9 w-9 rounded-full bg-surface flex items-center justify-center shrink-0 overflow-hidden">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt={p.username} className="h-full w-full object-cover" />
                    : <span className="text-sm font-bold text-primary">{p.username.charAt(0).toUpperCase()}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{p.username}</span>
                    {isMe && <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Você</span>}
                    {member.role === "owner" && <span className="text-[10px] font-bold text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">Dono</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{p.total_bets} apostas · {winRate}% acerto</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-sm">{formatCurrency(p.balance)}</div>
                  <div className={`text-xs font-medium ${p.total_profit >= 0 ? "text-primary" : "text-destructive"}`}>
                    {p.total_profit >= 0 ? "+" : ""}{formatCurrency(p.total_profit)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
