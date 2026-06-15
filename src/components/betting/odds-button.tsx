import { useBetSlip, type BetSelection } from "@/contexts/bet-slip-context";
import { formatOdds } from "@/utils/formatters";

export function OddsButton({ selection }: { selection: BetSelection }) {
  const { selections, addSelection, removeSelection } = useBetSlip();
  const active = selections.some(
    (s) => s.match_id === selection.match_id && s.selection === selection.selection && s.market_type === selection.market_type,
  );

  return (
    <button
      onClick={() =>
        active
          ? removeSelection(selection.match_id, selection.market_type)
          : addSelection(selection)
      }
      className={`flex flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-2 transition min-w-0 ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-surface border-border hover:border-primary/60 hover:bg-surface-2"
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide opacity-80 truncate w-full text-center">
        {selection.selection_label}
      </span>
      <span className="text-sm font-bold tabular-nums">{formatOdds(selection.odds_value)}</span>
    </button>
  );
}
