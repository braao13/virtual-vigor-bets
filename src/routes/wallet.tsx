import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Wallet as WalletIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/app-shell";
import { useAuth, type Profile } from "@/hooks/use-auth";
import { formatMoney, formatMatchDate } from "@/utils/formatters";

export const Route = createFileRoute("/wallet")({
  head: () => ({ meta: [{ title: "Carteira — CoelhoBet" }] }),
  component: () => (
    <AppShell>
      <WalletPage />
    </AppShell>
  ),
});

interface Tx {
  id: string;
  type: "initial_deposit" | "bet_placed" | "bet_won" | "bet_void" | "balance_reset";
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

const TYPE_LABEL: Record<Tx["type"], string> = {
  initial_deposit: "Depósito inicial",
  bet_placed: "Aposta realizada",
  bet_won: "Aposta ganha",
  bet_void: "Aposta anulada",
  balance_reset: "Saldo resetado",
};

function WalletPage() {
  const { user } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      return data as Profile | null;
    },
  });

  const { data: txs } = useQuery({
    queryKey: ["transactions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("id, type, amount, balance_after, description, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  return (
    <div className="px-4 md:px-8 py-6 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Carteira</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Saldo virtual e histórico de transações.
        </p>
      </header>

      <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/10 border border-primary/30 p-6 mb-8">
        <div className="flex items-center gap-2 text-primary text-xs uppercase tracking-wider font-bold">
          <WalletIcon className="h-4 w-4" /> Saldo virtual
        </div>
        <p className="mt-2 text-4xl font-black tabular-nums">
          {formatMoney(profile?.balance ?? 0)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground">Total apostas</p>
            <p className="font-bold text-sm">{profile?.total_bets ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Ganhas</p>
            <p className="font-bold text-sm">{profile?.total_won ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Lucro total</p>
            <p
              className={`font-bold text-sm tabular-nums ${
                (profile?.total_profit ?? 0) >= 0 ? "text-primary" : "text-destructive"
              }`}
            >
              {formatMoney(profile?.total_profit ?? 0)}
            </p>
          </div>
        </div>
      </div>

      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Transações
      </h2>
      <div className="rounded-xl bg-card border border-border divide-y divide-border">
        {(txs ?? []).map((t) => {
          const positive = t.amount >= 0;
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${
                  positive ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                }`}
              >
                {positive ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{TYPE_LABEL[t.type]}</p>
                <p className="text-xs text-muted-foreground truncate">{t.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p
                  className={`text-sm font-bold tabular-nums ${
                    positive ? "text-primary" : "text-destructive"
                  }`}
                >
                  {positive ? "+" : ""}
                  {formatMoney(t.amount)}
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {formatMatchDate(t.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        {txs && txs.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhuma transação ainda.
          </div>
        )}
      </div>
    </div>
  );
}
