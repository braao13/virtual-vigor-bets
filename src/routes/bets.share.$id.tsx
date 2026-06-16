import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Copy, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatMatchDate } from "@/utils/formatters";
import { useBetSlip } from "@/contexts/bet-slip-context";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/bets/share/$id")({
  head: () => ({ meta: [{ title: "Aposta compartilhada · Rabbet" }] }),
  component: SharedBetPage,
});

interface BetItem {
  id: string; market_type: string; selection: string; selection_label: string;
  odds_at_placement: number; line: number | null; status: string;
  matches: { id: string; home_team: string; away_team: string; league_name: string; match_date: string; status: string };
}
interface Bet {
  id: string; bet_type: string; total_odds: number; potential_return: number;
  actual_return: number | null; status: string; selections_count: number; created_at: string;
  profiles: { username: string; avatar_url: string | null };
  bet_items: BetItem[];
}

const MARKET_LABELS: Record<string, string> = {
  match_winner: "Resultado Final",
  double_chance: "Dupla Chance",
  both_teams_score: "Ambas Marcam",
  goals_over_under: "Total de Gols",
  corners_over_under: "Total de Escanteios",
  cards_over_under: "Total de Cartões",
};

function SharedBetPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { addSelection, openSlip } = useBetSlip();

  const { data: bet, isLoading } = useQuery({
    queryKey: ["shared-bet", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bets")
        .select(`id, bet_type, total_odds, potential_return, actual_return, status, selections_count, created_at,
          profiles (username, avatar_url),
          bet_items (id, market_type, selection, selection_label, odds_at_placement, line, status,
            matches (id, home_team, away_team, league_name, match_date, status))`)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Bet | null;
    },
  });

  const copyLink = () => { navigator.clipboard.writeText(window.location.href); toast.success("Link copiado!"); };

  const replicateBet = () => {
    if (!bet) return;
    const available = bet.bet_items.filter((item) => item.matches.status === "not_started");
    if (available.length === 0) { toast.error("Todos os jogos desta aposta já começaram."); return; }
    for (const item of available) {
      addSelection({
        match_id: item.matches.id,
        match_label: `${item.matches.home_team} vs ${item.matches.away_team}`,
        market_type: item.market_type as any,
        selection: item.selection,
        selection_label: item.selection_label,
        odds_value: item.odds_at_placement,
        line: item.line ?? undefined,
      });
    }
    openSlip();
    navigate({ to: "/" });
    toast.success(`${available.length} seleção(ões) adicionada(s) ao cupom!`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!bet) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>Aposta não encontrada.</p>
        <Link to="/" className="text-primary underline text-sm">Ir para o início</Link>
      </div>
    );
  }

  const statusConfig = {
    pending:   { icon: <Clock className="h-4 w-4 text-warning" />,            label: "Pendente" },
    won:       { icon: <CheckCircle2 className="h-4 w-4 text-primary" />,     label: "Ganha" },
    lost:      { icon: <XCircle className="h-4 w-4 text-destructive" />,      label: "Perdida" },
    void:      { icon: <Clock className="h-4 w-4 text-muted-foreground" />,   label: "Anulada" },
    cancelled: { icon: <XCircle className="h-4 w-4 text-muted-foreground" />, label: "Cancelada" },
  };
  const cfg = statusConfig[bet.status as keyof typeof statusConfig] ?? statusConfig.pending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-primary text-lg">Rabbet</Link>
          <button onClick={copyLink}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Copy className="h-4 w-4" />
            Copiar link
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-surface flex items-center justify-center overflow-hidden">
            {bet.profiles.avatar_url
              ? <img src={bet.profiles.avatar_url} alt={bet.profiles.username} className="h-full w-full object-cover" />
              : <span className="font-bold text-primary">{bet.profiles.username.charAt(0).toUpperCase()}</span>}
          </div>
          <div>
            <p className="font-semibold">{bet.profiles.username}</p>
            <p className="text-xs text-muted-foreground">{formatMatchDate(bet.created_at)}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden mb-4">
          <div className="divide-y divide-border">
            {bet.bet_items.map((item) => {
              const itemCfg = statusConfig[item.status as keyof typeof statusConfig] ?? statusConfig.pending;
              return (
                <div key={item.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">
                        {item.matches.home_team} vs {item.matches.away_team}
                      </p>
                      <p className="text-xs text-muted-foreground mb-1">
                        {MARKET_LABELS[item.market_type] ?? item.market_type}
                        {item.line != null ? ` ${item.line}` : ""}
                      </p>
                      <p className="font-semibold text-sm">{item.selection_label}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-primary">{item.odds_at_placement.toFixed(2)}</div>
                      <div className="flex items-center gap-1 justify-end mt-1">
                        {itemCfg.icon}
                        <span className="text-xs text-muted-foreground">{itemCfg.label}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 bg-surface border-t border-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tipo</span>
              <span className="font-medium">{bet.bet_type === "single" ? "Simples" : `Múltipla (${bet.selections_count} seleções)`}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Odd total</span>
              <span className="font-bold text-primary">{bet.total_odds.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1">{cfg.icon}<span className="font-medium">{cfg.label}</span></div>
            </div>
            {bet.actual_return != null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Retorno</span>
                <span className="font-bold text-primary">{formatCurrency(bet.actual_return)}</span>
              </div>
            )}
          </div>
        </div>

        <button onClick={replicateBet}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors">
          <ExternalLink className="h-4 w-4" />
          Fazer aposta igual
        </button>
        <p className="text-center text-xs text-muted-foreground mt-3">
          Apenas jogos ainda não iniciados serão adicionados ao seu cupom.
        </p>
      </div>
    </div>
  );
}
