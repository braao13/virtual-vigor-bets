import { useState } from "react";
import { X, Trash2, Receipt, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBetSlip } from "@/contexts/bet-slip-context";
import { placeBet } from "@/lib/bets.functions";
import { formatMoney, formatOdds } from "@/utils/formatters";

const QUICK_STAKES = [10, 25, 50, 100, 250];

export function BetSlip({ floating = false }: { floating?: boolean }) {
  const {
    selections,
    stake,
    setStake,
    removeSelection,
    clear,
    totalOdds,
    potentialReturn,
    isOpen,
    setOpen,
  } = useBetSlip();

  const place = useServerFn(placeBet);
  const qc = useQueryClient();
  const [stakeInput, setStakeInput] = useState(String(stake));

  const mutation = useMutation({
    mutationFn: async () => {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      return place({
        data: {
          idempotency_key: key,
          stake,
          selections: selections.map((s) => ({
            match_id: s.match_id,
            market_type: s.market_type,
            selection: s.selection,
            selection_label: s.selection_label,
            odds_value: s.odds_value,
            line: s.line ?? null,
          })),
        },
      });
    },
    onSuccess: () => {
      toast.success("Aposta registrada com sucesso!", {
        description: `Retorno potencial: ${formatMoney(potentialReturn)}`,
      });
      clear();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["bets"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e: Error) => {
      toast.error("Não foi possível registrar a aposta", { description: e.message });
    },
  });

  const empty = selections.length === 0;

  const Body = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wide">Cupom de Aposta</h2>
          {!empty && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              {selections.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!empty && (
            <button
              onClick={clear}
              className="text-muted-foreground hover:text-destructive"
              title="Limpar"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {floating && (
            <button onClick={() => setOpen(false)} className="md:hidden text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4 py-12">
            <Receipt className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium">Seu cupom está vazio</p>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em uma odd para adicionar uma seleção.
            </p>
          </div>
        ) : (
          selections.map((s) => (
            <div
              key={`${s.match_id}-${s.market_type}`}
              className="rounded-lg bg-surface p-3 border border-border"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase text-muted-foreground tracking-wide truncate">
                    {s.market_label}
                  </p>
                  <p className="text-sm font-semibold truncate">{s.selection_label}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{s.match_label}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded bg-primary/15 px-2 py-1 text-sm font-bold text-primary tabular-nums">
                    {formatOdds(s.odds_value)}
                  </span>
                  <button
                    onClick={() => removeSelection(s.match_id, s.market_type)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {!empty && (
        <div className="border-t border-border bg-surface-2 p-4 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Valor da aposta
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={stakeInput}
                onChange={(e) => {
                  setStakeInput(e.target.value);
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) setStake(v);
                }}
                className="w-full rounded-lg bg-background border border-border px-9 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {QUICK_STAKES.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setStake(v);
                    setStakeInput(String(v));
                  }}
                  className="rounded-md bg-surface border border-border px-2 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Odds total</span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatOdds(totalOdds)}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Retorno potencial</span>
              <span className="text-lg font-bold text-primary tabular-nums">
                {formatMoney(potentialReturn)}
              </span>
            </div>
          </div>

          <button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-bold uppercase tracking-wide text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition glow-primary flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mutation.isPending ? "Enviando..." : "Fazer Aposta"}
          </button>
        </div>
      )}
    </div>
  );

  if (!floating) {
    return (
      <aside className="hidden lg:flex w-80 shrink-0 flex-col border-l border-border bg-card">
        {Body}
      </aside>
    );
  }

  return (
    <>
      {/* Mobile floating button */}
      {!empty && !isOpen && (
        <button
          onClick={() => setOpen(true)}
          className="lg:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground glow-primary"
        >
          <Receipt className="h-4 w-4" />
          {selections.length} · {formatOdds(totalOdds)}
        </button>
      )}
      {/* Mobile drawer */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setOpen(false)}>
          <div
            className="absolute bottom-0 inset-x-0 h-[85vh] bg-card rounded-t-2xl border-t border-border"
            onClick={(e) => e.stopPropagation()}
          >
            {Body}
          </div>
        </div>
      )}
    </>
  );
}
