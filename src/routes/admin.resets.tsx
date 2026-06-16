import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, RefreshCw, Shield, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency, formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/admin/resets")({
  head: () => ({ meta: [{ title: "Admin — Reset de Saldo · Rabbet" }] }),
  component: () => (
    <AppShell>
      <AdminResets />
    </AppShell>
  ),
});

interface ResetRequest {
  id: string;
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  profiles: { username: string; email: string; balance: number };
}

function AdminResets() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("is_admin").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: requests, isLoading } = useQuery({
    queryKey: ["admin-reset-requests"],
    enabled: !!profile?.is_admin,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("balance_reset_requests")
        .select("id, reason, status, created_at, reviewed_at, profiles (username, email, balance)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ResetRequest[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.rpc("approve_balance_reset", { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reset-requests"] }); toast.success("Saldo resetado com sucesso!"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await (supabase as any)
        .from("balance_reset_requests")
        .update({ status: "rejected", reviewed_at: new Date().toISOString() })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-reset-requests"] }); toast.success("Pedido rejeitado."); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!profile?.is_admin) {
    return (
      <div className="px-4 py-12 text-center text-muted-foreground">
        <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>Acesso restrito a administradores.</p>
      </div>
    );
  }

  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const resolved = (requests ?? []).filter((r) => r.status !== "pending");

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-primary mb-1">
          <RefreshCw className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-wider">Admin</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold">Reset de Saldo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ao aprovar, o saldo volta para R$ 1.000 e as estatísticas são zeradas.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <h2 className="text-base font-bold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
            Pendentes ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm mb-6">Nenhum pedido pendente.</div>
          ) : (
            <div className="space-y-3 mb-8">
              {pending.map((req) => (
                <ResetRequestCard key={req.id} req={req}
                  onApprove={() => {
                    if (confirm(`Resetar saldo de ${req.profiles.username}? Isso zerará todas as estatísticas.`))
                      approveMutation.mutate(req.id);
                  }}
                  onReject={() => rejectMutation.mutate(req.id)}
                  loading={approveMutation.isPending || rejectMutation.isPending}
                />
              ))}
            </div>
          )}
          {resolved.length > 0 && (
            <>
              <h2 className="text-base font-bold mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                Histórico ({resolved.length})
              </h2>
              <div className="space-y-2">
                {resolved.map((req) => <ResetRequestCard key={req.id} req={req} loading={false} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ResetRequestCard({ req, onApprove, onReject, loading }: {
  req: ResetRequest; onApprove?: () => void; onReject?: () => void; loading: boolean;
}) {
  const isPending = req.status === "pending";
  const statusEl = (() => {
    if (req.status === "approved") return <span className="text-xs font-bold text-primary">✅ Aprovado</span>;
    if (req.status === "rejected") return <span className="text-xs font-bold text-destructive">❌ Rejeitado</span>;
    return <span className="text-xs font-bold text-warning">⏳ Pendente</span>;
  })();

  return (
    <div className="p-4 rounded-xl border border-border bg-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{req.profiles.username}</div>
          <div className="text-xs text-muted-foreground">{req.profiles.email}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Saldo atual: <span className="font-medium text-foreground">{formatCurrency(req.profiles.balance)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          {statusEl}
          <div className="text-xs text-muted-foreground mt-1">{formatMatchDate(req.created_at)}</div>
        </div>
      </div>
      {req.reason && (
        <p className="text-sm text-muted-foreground bg-surface rounded-lg px-3 py-2">"{req.reason}"</p>
      )}
      {isPending && onApprove && onReject && (
        <div className="flex gap-2 pt-1">
          <button disabled={loading} onClick={onReject}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-50">
            <XCircle className="h-4 w-4" />
            Rejeitar
          </button>
          <button disabled={loading} onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
            <RefreshCw className="h-4 w-4" />
            Aprovar reset
          </button>
        </div>
      )}
    </div>
  );
}
