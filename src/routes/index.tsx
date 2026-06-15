import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { OddsButton } from "@/components/betting/odds-button";
import { formatMatchDate, relativeDate } from "@/utils/formatters";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CoelhoBet — Partidas em destaque" },
      { name: "description", content: "Veja as próximas partidas e aposte com saldo virtual." },
    ],
  }),
  component: HomePage,
});

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  league_name: string;
  league_country: string | null;
  match_date: string;
  status: string;
}

interface Odd {
  id: string;
  match_id: string;
  market_type: "match_winner" | "double_chance" | "both_teams_score" | "goals_over_under";
  selection: string;
  selection_label: string;
  odds_value: number;
  line: number | null;
}

function HomePage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { data: matches } = useQuery({
    queryKey: ["matches", "upcoming"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .gte("match_date", new Date().toISOString())
        .order("match_date", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Match[];
    },
  });

  const { data: oddsByMatch } = useQuery({
    queryKey: ["odds", "match_winner"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("odds_cache")
        .select("*")
        .eq("market_type", "match_winner")
        .eq("is_active", true);
      if (error) throw error;
      const grouped: Record<string, Odd[]> = {};
      for (const o of (data ?? []) as Odd[]) {
        grouped[o.match_id] ??= [];
        grouped[o.match_id].push(o);
      }
      return grouped;
    },
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-primary">
          <Flame className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-wider">Em destaque</span>
        </div>
        <h1 className="mt-1 text-2xl md:text-3xl font-bold">Próximas partidas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Clique em uma cotação para adicionar ao seu cupom. Saldo virtual — sem dinheiro real.
        </p>
      </header>

      <div className="space-y-3">
        {(matches ?? []).map((m) => {
          const odds = oddsByMatch?.[m.id] ?? [];
          const home = odds.find((o) => o.selection === "home");
          const draw = odds.find((o) => o.selection === "draw");
          const away = odds.find((o) => o.selection === "away");
          const matchLabel = `${m.home_team} vs ${m.away_team}`;
          return (
            <div
              key={m.id}
              className="rounded-xl bg-card border border-border overflow-hidden hover:border-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground truncate">
                    {m.league_name}
                    {m.league_country && ` · ${m.league_country}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span className="tabular-nums">{formatMatchDate(m.match_date)}</span>
                </div>
              </div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-center">
                <Link
                  to="/matches/$id"
                  params={{ id: m.id }}
                  className="min-w-0 flex flex-col gap-1 hover:text-primary"
                >
                  <div className="flex items-center justify-between md:justify-start md:gap-6">
                    <span className="font-semibold">{m.home_team}</span>
                    <span className="text-xs text-muted-foreground">vs</span>
                    <span className="font-semibold">{m.away_team}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeDate(m.match_date)} · Ver todos os mercados
                    <ChevronRight className="inline h-3 w-3" />
                  </span>
                </Link>

                {home && draw && away && (
                  <div className="grid grid-cols-3 gap-2 md:w-72">
                    {[home, draw, away].map((o) => (
                      <OddsButton
                        key={o.id}
                        selection={{
                          match_id: m.id,
                          match_label: matchLabel,
                          market_type: "match_winner",
                          market_label: "Resultado Final",
                          selection: o.selection,
                          selection_label:
                            o.selection === "home"
                              ? "Casa"
                              : o.selection === "draw"
                                ? "Empate"
                                : "Fora",
                          odds_value: Number(o.odds_value),
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {matches && matches.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
            Nenhuma partida disponível no momento.
          </div>
        )}
      </div>
    </div>
  );
}
