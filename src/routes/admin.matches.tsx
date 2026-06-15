import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Play, RefreshCw, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { simulateMatchResult, settleBets } from "@/lib/settlement.functions";
import { formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/admin/matches")({
  head: () => ({ meta: [{ title: "Admin — Partidas · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <AdminMatches />
    </AppShell>
  ),
});

interface Match {
  id: string;
  home_team: string;
  away_team: string;
  league_name: string;
  match_date: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

interface SettlementResult {
  settled: number;
  won: number;
  lost: number;
  void: number;
}

function AdminMatches() {
  const qc = useQueryClient();
  const [scores, setScores] = useState<Record<string, { home: string; away: string; hCorners: string; aCorners: string; hCards: string; aCards: string }>>({});
  const [lastResult, setLastResult] = useState<SettlementResult | null>(null);

  const { data: matches, isLoading } = useQuery({
    queryKey: ["admin-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id, home_team, away_team, league_name, match_date, status, home_score, away_score")
        .in("status", ["not_started", "finished"])
        .order("match_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Match[];
    },
  });

  const simulateMut = useMutation({
    mutationFn: async (matchId: string) => {
      const s = scores[matchId];
      if (!s) throw new Error("Placar não preenchido");
      const home = parseInt(s.home, 10);
      const away = parseInt(s.away, 10);
      if (isNaN(home) || isNaN(away)) throw new Error("Placar inválido");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return simulateMatchResult({
        headers: { Authorization: `Bearer ${session.access_token}` },
        data: {
          match_id: matchId,
          home_score: home,
          away_score: away,
          home_corners: parseInt(s.hCorners || "0", 10) || 0,
          away_corners: parseInt(s.aCorners || "0", 10) || 0,
          home_cards: parseInt(s.hCards || "0", 10) || 0,
          away_cards: parseInt(s.aCards || "0", 10) || 0,
        },
      });
    },
    onSuccess: (result, matchId) => {
      setLastResult(result);
      setScores((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
      qc.invalidateQueries({ queryKey: ["admin-matches"] });
      toast.success(`Liquidadas ${result.settled} apostas · ${result.won} ganhas · ${result.lost} perdidas · ${result.void} anuladas`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const settleMut = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return settleBets({ headers: { Authorization: `Bearer ${session.access_token}` } });
    },
    onSuccess: (result) => {
      setLastResult(result);
      qc.invalidateQueries({ queryKey: ["admin-matches"] });
      toast.success(`Liquidadas ${result.settled} apostas · ${result.won} ganhas · ${result.lost} perdidas · ${result.void} anuladas`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setScore = (id: string, field: string, val: string) =>
    setScores((prev) => ({ ...prev, [id]: { home: "", away: "", hCorners: "", aCorners: "", hCards: "", aCards: "", ...prev[id], [field]: val } }));

  const notStarted = matches?.filter((m) => m.status === "not_started") ?? [];
  const finished = matches?.filter((m) => m.status === "finished") ?? [];

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto space-y-8">
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Painel Admin — Partidas</h1>
          <p className="text-sm text-muted-foreground mt-1">Simule resultados e liquide apostas pendentes.</p>
        </div>
        <button
          onClick={() => settleMut.mutate()}
          disabled={settleMut.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${settleMut.isPending ? "animate-spin" : ""}`} />
          Liquidar Apostas Agora
        </button>
      </header>

      {lastResult && (
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-sm font-semibold mb-2">Último resultado de liquidação</p>
          <div className="grid grid-cols-4 gap-4 text-center">
            {[
              { label: "Liquidadas", value: lastResult.settled, color: "text-foreground" },
              { label: "Ganhas", value: lastResult.won, color: "text-primary" },
              { label: "Perdidas", value: lastResult.lost, color: "text-destructive" },
              { label: "Anuladas", value: lastResult.void, color: "text-muted-foreground" },
            ].map((s) => (
              <div key={s.label}>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Matches not started */}
      <section>
        <h2 className="text-lg font-bold mb-3">Partidas não iniciadas</h2>
        {isLoading && <p className="text-muted-foreground text-sm">Carregando...</p>}
        {!isLoading && notStarted.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhuma partida pendente.</p>
        )}
        <div className="space-y-3">
          {notStarted.map((m) => {
            const s = scores[m.id] ?? {};
            const isSaving = simulateMut.isPending && simulateMut.variables === m.id;
            return (
              <article key={m.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 bg-surface-2 border-b border-border flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{m.home_team} vs {m.away_team}</p>
                    <p className="text-xs text-muted-foreground">{m.league_name} · {formatMatchDate(m.match_date)}</p>
                  </div>
                  <span className="text-xs rounded-full bg-warning/20 text-warning px-2 py-0.5 font-medium">
                    Não iniciada
                  </span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Gols {m.home_team}</span>
                      <input
                        type="number" min="0" max="99" placeholder="0"
                        value={s.home ?? ""}
                        onChange={(e) => setScore(m.id, "home", e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">Gols {m.away_team}</span>
                      <input
                        type="number" min="0" max="99" placeholder="0"
                        value={s.away ?? ""}
                        onChange={(e) => setScore(m.id, "away", e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </label>
                  </div>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground select-none">Escanteios e cartões (opcional)</summary>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      {[
                        ["hCorners", `Escanteios ${m.home_team}`],
                        ["aCorners", `Escanteios ${m.away_team}`],
                        ["hCards", `Cartões ${m.home_team}`],
                        ["aCards", `Cartões ${m.away_team}`],
                      ].map(([field, label]) => (
                        <label key={field} className="space-y-1">
                          <span className="text-xs text-muted-foreground">{label}</span>
                          <input
                            type="number" min="0" max="99" placeholder="0"
                            value={(s as Record<string, string>)[field] ?? ""}
                            onChange={(e) => setScore(m.id, field, e.target.value)}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  <button
                    onClick={() => simulateMut.mutate(m.id)}
                    disabled={isSaving || !s.home || !s.away}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    <Play className={`h-4 w-4 ${isSaving ? "animate-spin" : ""}`} />
                    Finalizar Partida
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Finished matches */}
      <section>
        <h2 className="text-lg font-bold mb-3">Partidas finalizadas</h2>
        {!isLoading && finished.length === 0 && (
          <p className="text-muted-foreground text-sm">Nenhuma partida finalizada ainda.</p>
        )}
        <div className="space-y-2">
          {finished.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold">{m.home_team} vs {m.away_team}</p>
                <p className="text-xs text-muted-foreground">{m.league_name}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold tabular-nums">
                  {m.home_score ?? 0} – {m.away_score ?? 0}
                </span>
                <span className="text-xs rounded-full bg-primary/20 text-primary px-2 py-0.5 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Finalizada
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
