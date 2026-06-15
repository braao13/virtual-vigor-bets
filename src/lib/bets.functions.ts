import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const selectionSchema = z.object({
  match_id: z.string().uuid(),
  market_type: z.enum(["match_winner", "double_chance", "both_teams_score", "goals_over_under", "corners_over_under", "cards_over_under"]),
  selection: z.string().min(1).max(64),
  selection_label: z.string().min(1).max(128),
  odds_value: z.number().min(1.01).max(10000),
  line: z.number().nullable().optional(),
});

const placeBetSchema = z.object({
  idempotency_key: z.string().min(8).max(128),
  stake: z.number().min(1).max(100000),
  selections: z.array(selectionSchema).min(1).max(30),
});

export const placeBet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => placeBetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: betId, error } = await supabase.rpc("place_bet", {
      p_idempotency_key: data.idempotency_key,
      p_stake: data.stake,
      p_selections: data.selections.map((s) => ({
        match_id: s.match_id,
        market_type: s.market_type,
        selection: s.selection,
        selection_label: s.selection_label,
        odds_value: s.odds_value,
        line: s.line ?? null,
      })) as never,
    });

    if (error) {
      throw new Error(error.message || "Falha ao registrar aposta");
    }

    return { bet_id: betId as string };
  });
