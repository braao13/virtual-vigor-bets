import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const settleBets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("settle_pending_bets");
    if (error) throw new Error(error.message || "Falha ao liquidar apostas");
    return data as { settled: number; won: number; lost: number; void: number };
  });

const simulateSchema = z.object({
  match_id: z.string().uuid(),
  home_score: z.number().int().min(0).max(99),
  away_score: z.number().int().min(0).max(99),
  home_corners: z.number().int().min(0).max(99).default(0),
  away_corners: z.number().int().min(0).max(99).default(0),
  home_cards: z.number().int().min(0).max(99).default(0),
  away_cards: z.number().int().min(0).max(99).default(0),
});

export const simulateMatchResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => simulateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: result, error } = await supabase.rpc("simulate_match_result", {
      p_match_id: data.match_id,
      p_home_score: data.home_score,
      p_away_score: data.away_score,
      p_home_corners: data.home_corners,
      p_away_corners: data.away_corners,
      p_home_cards: data.home_cards,
      p_away_cards: data.away_cards,
    });
    if (error) throw new Error(error.message || "Falha ao simular resultado");
    return result as { settled: number; won: number; lost: number; void: number };
  });
