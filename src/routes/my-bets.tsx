import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, Trophy, XCircle, CircleSlash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney, formatOdds, formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/my-bets")({
  head: () => ({ meta: [{ title: "Minhas Apostas — Rabbet" }] }),
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
  settled_at: string | null;
  bet_items: BetItem[];
}

const BET_STATUS = {
  pending:   { label: "Pendente",  icon: Clock,        color: "text-warning" },
  won:       { label: "Ganha",     icon: Trophy,       color: "text-primary" },
  lost:      { label: "Perdida",   icon: XCircle,      color: "text-destructive" },
  cancelled: { label: "Cancelada", icon: CircleSlash,  color: "text-muted-foreground" },
  void:      { label: "Anulada",   icon: CircleSlash,  color: "text-muted-foreground" },
} as const;

const ITEM_STATUS: Record<string, { dot: string; label: string }> = {
  pending: { dot: "bg-warning",           label: "Pendente" },
  won:     { dot: "bg-primary",           label: "Ganha" },
  lost:    { dot: "bg-destructive",       label: "Perdida" },
  void:    { dot: "bg-muted-foreground",  label: "Anulada" },
  cancelled: { dot: "bg-muted-foreground", label: "Cancelada" },
};

function MyBets() {
  const { user } = useAuth();
  const { data: bets } = useQuery({
    queryKey: ["bets", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bets")
        .select(
          "id, stake, total_odds, potential_return, actual_return, status, selections_count, created_at, settled_at, bet_items(selection_label, odds_at_placement, status, matches(home_team, away_team, match_date))",
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
          const s = BET_STATUS[b.status];
          const Icon = s.icon;
          const isMultiple = b.selections_count > 1;
          const profit = b.actual_return != null ? b.actual_return - b.stake : null;

          return (
            <article key={b.id} className="rounded-xl bg-card border border-border overflow-hidden">
              <header className="flex items-center justify-between bg-surface-2 px-4 py-2.5 border-b border-border">
                <div className={`flex items-center gap-2 text-xs font-bold ${s.color}`}>
                  <Icon className="h-4 w-4" />
                  <span className="uppercase tracking-wider">{s.label}</span>
                  <span className="text-muted-foreground font-normal">
                    · {isMultiple ? `Múltipla (${b.selections_count})` : "Simples"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatMatchDate(b.created_at)}
                </span>
              </header>

              <div className="px-4 py-3 space-y-2">
                {b.bet_items.map((it, i) => {
                  const itemMeta = ITEM_STATUS[it.status] ?? ITEM_STATUS.pending;
                  return (
                    <div key={i} className="flex items-start justify-between gap-2 text-sm">
                      <div className="min-w-0 flex items-start gap-2">
                        {isMultiple && (
                          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${itemMeta.dot}`} title={itemMeta.label} />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium truncate">{it.selection_label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {it.matches
                              ? `${it.matches.home_team} vs ${it.matches.away_team}`
                              : "Partida indisponível"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isMultiple && it.status !== "pending" && (
                          <span className={`text-xs font-medium ${
                            it.status === "won" ? "text-primary" :
                            it.status === "lost" ? "text-destructive" :
                            "text-muted-foreground"
                          }`}>
                            {itemMeta.label}
                          </span>
                        )}
                        <span className="text-sm font-bold text-primary tabular-nums">
                          {formatOdds(it.odds_at_placement)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <footer className="grid grid-cols-3 gap-2 px-4 py-3 border-t border-border bg-surface/40 text-xs">
                <div>
                  <p className="text-muted-foreground">Aposta</p>
                  <p className="font-bold tabular-nums">{formatMoney(b.stake)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Odds totais</p>
                  <p className="font-bold tabular-nums">{formatOdds(b.total_odds)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {b.status === "won" ? "Recebido" :
                     b.status === "void" ? "Estornado" :
                     "Retorno potencial"}
                  </p>
                  <p className={`font-bold tabular-nums ${
                    b.status === "won" ? "text-primary" :
                    b.status === "lost" ? "text-destructive" : ""
                  }`}>
                    {formatMoney(b.actual_return ?? b.potential_return)}
                  </p>
                </div>

                {/* Profit / loss row */}
                {profit != null && b.status !== "void" && (
                  <div className="col-span-3 pt-2 border-t border-border/50 flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {b.settled_at ? `Liquidada ${formatMatchDate(b.settled_at)}` : ""}
                    </span>
                    <span className={`font-bold tabular-nums ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
                      {profit >= 0 ? "+" : ""}{formatMoney(profit)}
                    </span>
                  </div>
                )}
                {b.status === "void" && b.settled_at && (
                  <div className="col-span-3 pt-2 border-t border-border/50">
                    <span className="text-muted-foreground">Liquidada {formatMatchDate(b.settled_at)}</span>
                  </div>
                )}
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
