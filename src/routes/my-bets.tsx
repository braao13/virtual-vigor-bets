import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Trophy, XCircle, CircleSlash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney, formatOdds, formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/my-bets")({
  head: () => ({ meta: [{ title: "Minhas Apostas — CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <MyBets />
    </AppShell>
  ),
});

interface BetItem {
  selection_label: string;
  odds_at_placement: number;
  status: string;
  matches: { home_team: string; away_team: string; match_date: string } | null;
}
interface Bet {
  id: string;
  stake: number;
  total_odds: number;
  potential_return: number;
  actual_return: number | null;
  status: "pending" | "won" | "lost" | "cancelled" | "void";
  selections_count: number;
  created_at: string;
  bet_items: BetItem[];
}

const STATUS = {
  pending: { label: "Pendente", icon: Clock, color: "text-warning" },
  won: { label: "Ganha", icon: Trophy, color: "text-primary" },
  lost: { label: "Perdida", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "Cancelada", icon: CircleSlash, color: "text-muted-foreground" },
  void: { label: "Anulada", icon: CircleSlash, color: "text-muted-foreground" },
} as const;

function MyBets() {
  const { user } = useAuth();
  const { data: bets } = useQuery({
    queryKey: ["bets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bets")
        .select(
          "id, stake, total_odds, potential_return, actual_return, status, selections_count, created_at, bet_items(selection_label, odds_at_placement, status, matches(home_team, away_team, match_date))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Bet[];
    },
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Minhas apostas</h1>
        <p className="text-sm text-muted-foreground mt-1">Histórico completo das suas apostas.</p>
      </header>

      <div className="space-y-3">
        {(bets ?? []).map((b) => {
          const s = STATUS[b.status];
          const Icon = s.icon;
          return (
            <article key={b.id} className="rounded-xl bg-card border border-border overflow-hidden">
              <header className="flex items-center justify-between bg-surface-2 px-4 py-2.5 border-b border-border">
                <div className={`flex items-center gap-2 text-xs font-bold ${s.color}`}>
                  <Icon className="h-4 w-4" />
                  <span className="uppercase tracking-wider">{s.label}</span>
                  <span className="text-muted-foreground font-normal">
                    · {b.selections_count === 1 ? "Simples" : `Múltipla (${b.selections_count})`}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatMatchDate(b.created_at)}
                </span>
              </header>

              <div className="px-4 py-3 space-y-2">
                {b.bet_items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{it.selection_label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {it.matches
                          ? `${it.matches.home_team} vs ${it.matches.away_team}`
                          : "Partida indisponível"}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-primary tabular-nums shrink-0">
                      {formatOdds(it.odds_at_placement)}
                    </span>
                  </div>
                ))}
              </div>

              <footer className="grid grid-cols-3 gap-2 px-4 py-3 border-t border-border bg-surface/40 text-xs">
                <div>
                  <p className="text-muted-foreground">Aposta</p>
                  <p className="font-bold tabular-nums">{formatMoney(b.stake)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Odds</p>
                  <p className="font-bold tabular-nums">{formatOdds(b.total_odds)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {b.status === "won" ? "Recebido" : "Retorno potencial"}
                  </p>
                  <p
                    className={`font-bold tabular-nums ${
                      b.status === "won" ? "text-primary" : ""
                    }`}
                  >
                    {formatMoney(b.actual_return ?? b.potential_return)}
                  </p>
                </div>
              </footer>
            </article>
          );
        })}
        {bets && bets.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            Você ainda não fez nenhuma aposta.
          </div>
        )}
      </div>
    </div>
  );
}
