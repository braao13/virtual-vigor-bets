import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertCircle, CheckCircle2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { syncOddsApi, syncMatchResults } from "@/lib/odds-sync.functions";
import { syncApiFootballFixtures, syncApiFootballResults } from "@/lib/apifootball-sync.functions";
import { formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/admin/sync")({
  head: () => ({ meta: [{ title: "Admin — Sync APIs · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <AdminSync />
    </AppShell>
  ),
});

interface SyncLog {
  action: string;
  result: string;
  timestamp: string;
  success: boolean;
}

function AdminSync() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: matchCounts } = useQuery({
    queryKey: ["admin-match-counts"],
    enabled: !!profile?.is_admin,
    queryFn: async () => {
      const { data } = await supabase
        .from("matches")
        .select("status");
      const all = data ?? [];
      return {
        total: all.length,
        not_started: all.filter((m) => m.status === "not_started").length,
        finished: all.filter((m) => m.status === "finished").length,
        live: all.filter((m) => m.status === "live").length,
      };
    },
    refetchInterval: 30_000,
  });

  const [logs, setLogs] = React.useState<SyncLog[]>([]);

  const addLog = (action: string, result: string, success: boolean) => {
    setLogs((prev) => [
      { action, result, timestamp: new Date().toISOString(), success },
      ...prev.slice(0, 19),
    ]);
  };

  const syncOdds = useServerFn(syncOddsApi);
  const syncResults = useServerFn(syncMatchResults);
  const syncFixtures = useServerFn(syncApiFootballFixtures);
  const syncApiResults = useServerFn(syncApiFootballResults);

  const oddsMut = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return syncOdds({ headers: { Authorization: `Bearer ${session.access_token}` } });
    },
    onSuccess: (r) => {
      const msg = `${r.totalMatches} partidas, ${r.totalOdds} odds`;
      toast.success("TheOddsAPI: " + msg);
      addLog("TheOddsAPI — Partidas e Odds", msg + (r.errors.length ? ` (${r.errors.length} erros)` : ""), true);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      addLog("TheOddsAPI — Partidas e Odds", e.message, false);
    },
  });

  const fixturesMut = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return syncFixtures({ headers: { Authorization: `Bearer ${session.access_token}` } });
    },
    onSuccess: (r) => {
      const msg = `${r.totalSynced} partidas sincronizadas`;
      toast.success("API-Football: " + msg);
      addLog("API-Football — Fixtures", msg + (r.errors.length ? ` (${r.errors.length} erros)` : ""), true);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      addLog("API-Football — Fixtures", e.message, false);
    },
  });

  const resultsMut = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      return syncApiResults({ headers: { Authorization: `Bearer ${session.access_token}` } });
    },
    onSuccess: (r) => {
      const msg = `${r.totalUpdated} resultados, ${r.totalSettled} apostas liquidadas`;
      toast.success("Resultados: " + msg);
      addLog("API-Football — Resultados", msg + (r.errors.length ? ` (${r.errors.length} erros)` : ""), true);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      addLog("API-Football — Resultados", e.message, false);
    },
  });

  const syncAll = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [odds, fixtures, results] = await Promise.allSettled([
        syncOdds({ headers }),
        syncFixtures({ headers }),
        syncApiResults({ headers }),
      ]);
      return { odds, fixtures, results };
    },
    onSuccess: () => {
      toast.success("Sync completo!");
      addLog("Sync completo", "Odds + Fixtures + Resultados", true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isLoading = oddsMut.isPending || fixturesMut.isPending || resultsMut.isPending || syncAll.isPending;

  if (!profile?.is_admin) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground">
        Acesso restrito.
      </div>
    );
  }

  const actions = [
    {
      title: "TheOddsAPI — Odds",
      description: "Busca partidas e odds dos próximos 7 dias",
      icon: <Activity className="h-5 w-5 text-blue-400" />,
      onClick: () => oddsMut.mutate(),
      loading: oddsMut.isPending,
      color: "border-blue-500/20 hover:border-blue-500/40",
    },
    {
      title: "API-Football — Fixtures",
      description: "Sincroniza partidas com logos e dados completos",
      icon: <Zap className="h-5 w-5 text-yellow-400" />,
      onClick: () => fixturesMut.mutate(),
      loading: fixturesMut.isPending,
      color: "border-yellow-500/20 hover:border-yellow-500/40",
    },
    {
      title: "API-Football — Resultados",
      description: "Atualiza placar, escanteios, cartões e liquida apostas",
      icon: <CheckCircle2 className="h-5 w-5 text-primary" />,
      onClick: () => resultsMut.mutate(),
      loading: resultsMut.isPending,
      color: "border-primary/20 hover:border-primary/40",
    },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-primary mb-1">
          <RefreshCw className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-wider">Admin</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold">Sync de APIs</h1>
      </header>

      {/* Contadores */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total", value: matchCounts?.total ?? 0 },
          { label: "Aguardando", value: matchCounts?.not_started ?? 0 },
          { label: "Ao vivo", value: matchCounts?.live ?? 0 },
          { label: "Finalizadas", value: matchCounts?.finished ?? 0 },
        ].map((c) => (
          <div key={c.label} className="p-3 rounded-xl border border-border bg-card text-center">
            <div className="text-xl font-bold">{c.value}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Sync tudo */}
      <button
        disabled={isLoading}
        onClick={() => syncAll.mutate()}
        className="w-full mb-6 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${syncAll.isPending ? "animate-spin" : ""}`} />
        {syncAll.isPending ? "Sincronizando tudo..." : "Sync Completo (Tudo)"}
      </button>

      {/* Ações individuais */}
      <div className="space-y-3 mb-6">
        {actions.map((a) => (
          <button
            key={a.title}
            disabled={isLoading}
            onClick={a.onClick}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border bg-card text-left transition-colors disabled:opacity-50 ${a.color}`}
          >
            <div className="shrink-0">{a.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.description}</div>
            </div>
            {a.loading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            ) : (
              <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Log de execuções */}
      {logs.length > 0 && (
        <>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Log de execuções
          </h2>
          <div className="space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                {log.success ? (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{log.action}</div>
                  <div className="text-xs text-muted-foreground">{log.result}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {formatMatchDate(log.timestamp)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// React precisa ser importado para useState
import React from "react";
