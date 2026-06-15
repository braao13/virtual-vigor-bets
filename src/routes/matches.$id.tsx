import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { OddsButton } from "@/components/betting/odds-button";
import { formatMatchDate } from "@/utils/formatters";
import type { BetSelection } from "@/contexts/bet-slip-context";

export const Route = createFileRoute("/matches/$id")({
  component: MatchDetailRoute,
});

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  league_name: string;
  league_country: string | null;
  match_date: string;
}
interface Odd {
  id: string;
  market_type: BetSelection["market_type"];
  selection: string;
  selection_label: string;
  odds_value: number;
  line: number | null;
}

const MARKET_LABELS: Record<BetSelection["market_type"], string> = {
  match_winner: "🏆 Resultado Final",
  double_chance: "🎯 Dupla Chance",
  both_teams_score: "⚽ Ambas Marcam",
  goals_over_under: "📊 Total de Gols",
};

function MatchDetailRoute() {
  return (
    <AppShell>
      <MatchDetail />
    </AppShell>
  );
}

function MatchDetail() {
  const { id } = Route.useParams();

  const { data: match, isLoading } = useQuery({
    queryKey: ["match", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("matches").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Match | null;
    },
  });

  const { data: odds } = useQuery({
    queryKey: ["odds", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("odds_cache")
        .select("*")
        .eq("match_id", id)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as Odd[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground">
        Partida não encontrada.{" "}
        <Link to="/" className="text-primary underline">
          Voltar
        </Link>
      </div>
    );
  }

  const matchLabel = `${match.home_team} vs ${match.away_team}`;
  const grouped: Record<string, Odd[]> = {};
  for (const o of odds ?? []) {
    grouped[o.market_type] ??= [];
    grouped[o.market_type].push(o);
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <header className="rounded-2xl bg-card border border-border p-6 mb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
          {match.league_name}
          {match.league_country && ` · ${match.league_country}`}
        </p>
        <div className="mt-3 grid grid-cols-3 items-center gap-4 text-center">
          <div>
            <p className="text-lg md:text-xl font-bold">{match.home_team}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Casa</p>
          </div>
          <div className="text-2xl font-black text-muted-foreground">VS</div>
          <div>
            <p className="text-lg md:text-xl font-bold">{match.away_team}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Fora</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span className="tabular-nums">{formatMatchDate(match.match_date)}</span>
        </div>
      </header>

      <div className="space-y-4">
        {(Object.keys(MARKET_LABELS) as BetSelection["market_type"][]).map((mk) => {
          const items = grouped[mk];
          if (!items?.length) return null;
          const isOverUnder = mk === "goals_over_under";
          // For over/under, group by line
          if (isOverUnder) {
            const byLine: Record<string, Odd[]> = {};
            for (const o of items) {
              const k = String(o.line ?? "");
              byLine[k] ??= [];
              byLine[k].push(o);
            }
            return (
              <section key={mk} className="rounded-xl bg-card border border-border overflow-hidden">
                <div className="bg-surface-2 border-b border-border px-4 py-2.5">
                  <h2 className="text-sm font-bold">{MARKET_LABELS[mk]}</h2>
                </div>
                <div className="p-4 space-y-3">
                  {Object.entries(byLine)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([line, ods]) => (
                      <div key={line} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Linha {line}
                        </span>
                        {ods.map((o) => (
                          <OddsButton
                            key={o.id}
                            selection={{
                              match_id: id,
                              match_label: matchLabel,
                              market_type: mk,
                              market_label: MARKET_LABELS[mk],
                              selection: o.selection,
                              selection_label: o.selection_label,
                              odds_value: Number(o.odds_value),
                              line: o.line,
                            }}
                          />
                        ))}
                      </div>
                    ))}
                </div>
              </section>
            );
          }
          return (
            <section key={mk} className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="bg-surface-2 border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-bold">{MARKET_LABELS[mk]}</h2>
              </div>
              <div className={`p-4 grid gap-2 ${items.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                {items.map((o) => (
                  <OddsButton
                    key={o.id}
                    selection={{
                      match_id: id,
                      match_label: matchLabel,
                      market_type: mk,
                      market_label: MARKET_LABELS[mk],
                      selection: o.selection,
                      selection_label: o.selection_label,
                      odds_value: Number(o.odds_value),
                      line: o.line,
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
