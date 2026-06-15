import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/leagues")({
  head: () => ({ meta: [{ title: "Ligas · CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <LeaguesPage />
    </AppShell>
  ),
});

interface League {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  max_members: number;
}

function LeaguesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const { data: leagues, isLoading } = useQuery({
    queryKey: ["my-leagues", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("league_members")
        .select("league_id, role, leagues (id, name, description, invite_code, owner_id, max_members)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((d: any) => ({ ...d.leagues, my_role: d.role })) as (League & { my_role: string })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_league", {
        p_name: createName.trim(),
        p_description: createDesc.trim() || null,
      });
      if (error) throw error;
      return data as { league_id: string; invite_code: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-leagues"] });
      setShowCreate(false); setCreateName(""); setCreateDesc("");
      toast.success("Liga criada! Código: " + data.invite_code);
      navigate({ to: "/leagues/$id", params: { id: data.league_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const joinMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("join_league", {
        p_invite_code: joinCode.trim().toUpperCase(),
      });
      if (error) throw error;
      return data as { league_id: string; league_name: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-leagues"] });
      setShowJoin(false); setJoinCode("");
      toast.success("Entrou em " + data.league_name);
      navigate({ to: "/leagues/$id", params: { id: data.league_id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary mb-1">
            <Users className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-wider">Ligas privadas</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">Minhas Ligas</h1>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => { setShowJoin(true); setShowCreate(false); }}
            className="px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-surface transition-colors"
          >
            Entrar
          </button>
          <button
            onClick={() => { setShowCreate(true); setShowJoin(false); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Criar
          </button>
        </div>
      </header>

      {showCreate && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-card space-y-3">
          <h3 className="font-semibold">Nova liga</h3>
          <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Nome da liga *"
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          <input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="Descrição (opcional)"
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)}
              className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface transition-colors">
              Cancelar
            </button>
            <button disabled={!createName.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {createMutation.isPending ? "Criando..." : "Criar liga"}
            </button>
          </div>
        </div>
      )}

      {showJoin && (
        <div className="mb-4 p-4 rounded-xl border border-border bg-card space-y-3">
          <h3 className="font-semibold">Entrar em uma liga</h3>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Código de convite (ex: ABC12345)" maxLength={8}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-primary" />
          <div className="flex gap-2">
            <button onClick={() => setShowJoin(false)}
              className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface transition-colors">
              Cancelar
            </button>
            <button disabled={joinCode.length < 6 || joinMutation.isPending} onClick={() => joinMutation.mutate()}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {joinMutation.isPending ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : leagues?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Você não está em nenhuma liga.</p>
          <p className="text-sm mt-1">Crie uma ou entre com um código de convite.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(leagues ?? []).map((league) => (
            <LeagueCard key={league.id} league={league} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeagueCard({ league }: { league: League & { my_role: string } }) {
  const copyCode = () => { navigator.clipboard.writeText(league.invite_code); toast.success("Código copiado!"); };
  return (
    <Link to="/leagues/$id" params={{ id: league.id }}
      className="block p-4 rounded-xl border border-border bg-card hover:border-primary/40 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{league.name}</span>
            {league.my_role === "owner" && (
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">Dono</span>
            )}
          </div>
          {league.description && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{league.description}</p>
          )}
        </div>
        <button onClick={(e) => { e.preventDefault(); copyCode(); }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-border text-xs font-mono font-medium transition-colors shrink-0">
          <Copy className="h-3 w-3" />
          {league.invite_code}
        </button>
      </div>
    </Link>
  );
}
