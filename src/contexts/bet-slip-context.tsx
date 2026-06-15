import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface BetSelection {
  match_id: string;
  match_label: string; // "Flamengo vs Palmeiras"
  market_type: "match_winner" | "double_chance" | "both_teams_score" | "goals_over_under";
  market_label: string; // "Resultado Final"
  selection: string;
  selection_label: string;
  odds_value: number;
  line?: number | null;
}

interface BetSlipContextValue {
  selections: BetSelection[];
  stake: number;
  setStake: (n: number) => void;
  addSelection: (s: BetSelection) => void;
  removeSelection: (matchId: string, marketType: string) => void;
  clear: () => void;
  totalOdds: number;
  potentialReturn: number;
  isOpen: boolean;
  setOpen: (b: boolean) => void;
}

const BetSlipContext = createContext<BetSlipContextValue | null>(null);

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [selections, setSelections] = useState<BetSelection[]>([]);
  const [stake, setStake] = useState<number>(10);
  const [isOpen, setOpen] = useState(false);

  const addSelection = useCallback((s: BetSelection) => {
    setSelections((prev) => {
      // Replace any existing selection for same match+market (one per market per match)
      const filtered = prev.filter(
        (p) => !(p.match_id === s.match_id && p.market_type === s.market_type),
      );
      if (filtered.length >= 30) return prev;
      return [...filtered, s];
    });
    setOpen(true);
  }, []);

  const removeSelection = useCallback((matchId: string, marketType: string) => {
    setSelections((prev) =>
      prev.filter((p) => !(p.match_id === matchId && p.market_type === marketType)),
    );
  }, []);

  const clear = useCallback(() => setSelections([]), []);

  const totalOdds = selections.reduce((acc, s) => acc * s.odds_value, 1);
  const potentialReturn = stake * totalOdds;

  return (
    <BetSlipContext.Provider
      value={{
        selections,
        stake,
        setStake,
        addSelection,
        removeSelection,
        clear,
        totalOdds,
        potentialReturn,
        isOpen,
        setOpen,
      }}
    >
      {children}
    </BetSlipContext.Provider>
  );
}

export function useBetSlip() {
  const ctx = useContext(BetSlipContext);
  if (!ctx) throw new Error("useBetSlip must be used within BetSlipProvider");
  return ctx;
}
