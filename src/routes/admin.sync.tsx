import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, CheckCircle2, DatabaseZap, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { syncMatchesAndOdds } from "@/lib/sync.functions";

export const Route = createFileRoute("/admin/sync")({
  head: () => ({ meta: [{ title: "Admin — Sync · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <SyncPanel />
    </AppShell>
  ),
});

interface SyncResult {
  matches_upserted: number;
  odds_upserted: number;
  errors: string[];
}

function SyncPanel() {
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const syncMut = useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return syncMatchesAndOdds({
        headers: { Authorization: `Bearer ${session.access_token}` },
        data: undefined,
      });
    },
    onSuccess: (result) => {
      setLastResult(result);
      if (result.errors.length === 0) {
        toast.success(
          `Sync concluído — ${result.matches_upserted} partidas · ${result.odds_upserted} odds`,
        );
      } else {
        toast.warning(
          `Sync com erros — ${result.matches_upserted} partidas · ${result.errors.length} erros`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Sync de Partidas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Importa jogos e odds das principais ligas via TheOddsAPI.
          </p>
        </div>
        <button
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {syncMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncMut.isPending ? "Sincronizando..." : "Sincronizar Agora"}
        </button>
      </header>

      {/* Ligas sincronizadas */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <DatabaseZap className="h-4 w-4 text-primary" />
          Ligas incluídas no sync
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
          {[
          "Brasileirao Serie A",
          "Premier League",
          "La Liga",
          "Serie A",
          "Bundesliga",
          "Ligue 1",
          "Champions League",
          "Copa Libertadores",
            ].map((liga) => (
            <li key={liga} className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
              {liga}
            </li>
          ))}
        </ul>
      </section>

      {/* Resultado do último sync */}
      {lastResult && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-sm font-semibold">Último resultado</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-primary">{lastResult.matches_upserted}</p>
              <p className="text-xs text-muted-foreground mt-1">Partidas</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-primary">{lastResult.odds_upserted}</p>
              <p className="text-xs text-muted-foreground mt-1">Odds</p>
            </div>
            <div>
              <p
                className={`text-2xl font-bold ${lastResult.errors.length > 0 ? "text-destructive" : "text-primary"}`}
              >
                {lastResult.errors.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Erros</p>
            </div>
          </div>

          {lastResult.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                Erros encontrados
              </div>
              <ul className="space-y-0.5">
                {lastResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-muted-foreground font-mono">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Info */}
      <section className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground space-y-2">
        <p className="font-semibold text-foreground">Como funciona</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Busca eventos futuros nas ligas configuradas</li>
          <li>Faz upsert das partidas evitando duplicatas</li>
          <li>Desativa odds antigas e insere as atualizadas</li>
          <li>Mercados: Resultado Final, Dupla Chance, Ambas Marcam, Total de Gols</li>
        </ul>
      </section>
    </div>
  );
}
