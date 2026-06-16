import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsAPIBookmaker[];
}

interface OddsAPIBookmaker {
  key: string;
  title: string;
  markets: OddsAPIMarket[];
}

interface OddsAPIMarket {
  key: string;
  outcomes: OddsAPIOutcome[];
}

interface OddsAPIOutcome {
  name: string;
  price: number;
  point?: number;
}

interface SyncResult {
  matches_upserted: number;
  odds_upserted: number;
  errors: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Sports suportados (futebol internacional)
const SPORTS = [
  "soccer_brazil_campeonato",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_uefa_champs_league",
  "soccer_conmebol_copa_libertadores",
];

// Mercados mapeados para o enum market_type do banco
const MARKET_MAP: Record<string, string> = {
  h2h: "match_winner",
  doubleChance: "double_chance",
  btts: "both_teams_score",
  totals: "goals_over_under",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSelectionLabel(
  market: string,
  outcomeName: string,
  homeTeam: string,
  awayTeam: string,
  point?: number,
): { selection: string; label: string } {
  switch (market) {
    case "match_winner": {
      if (outcomeName === homeTeam) return { selection: "home", label: "Casa" };
      if (outcomeName === awayTeam) return { selection: "away", label: "Fora" };
      return { selection: "draw", label: "Empate" };
    }
    case "double_chance": {
      if (outcomeName.includes(homeTeam) || outcomeName === "1X")
        return { selection: "home_draw", label: "Casa ou Empate" };
      if (outcomeName.includes(awayTeam) || outcomeName === "X2")
        return { selection: "away_draw", label: "Fora ou Empate" };
      return { selection: "home_away", label: "Casa ou Fora" };
    }
    case "both_teams_score": {
      const isYes = outcomeName === "Yes";
      return { selection: isYes ? "yes" : "no", label: isYes ? "Sim" : "Não" };
    }
    case "goals_over_under": {
      const isOver = outcomeName === "Over";
      return {
        selection: isOver ? "over" : "under",
        label: isOver ? `Mais de ${point}` : `Menos de ${point}`,
      };
    }
    default:
      return { selection: outcomeName.toLowerCase(), label: outcomeName };
  }
}

// ─── Server Function ──────────────────────────────────────────────────────────

export const syncMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { supabase } = context;

    // Verify admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .single();

    if (!profile?.is_admin) {
      throw new Error("Acesso negado: apenas administradores podem executar sync.");
    }

    const ODDS_API_KEY = process.env.ODDS_API_KEY ?? process.env.VITE_ODDS_API_KEY;
    if (!ODDS_API_KEY) throw new Error("ODDS_API_KEY não configurada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const result: SyncResult = { matches_upserted: 0, odds_upserted: 0, errors: [] };

    for (const sport of SPORTS) {
      try {
        const url = `${ODDS_API_BASE}/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,doubleChance,btts,totals&oddsFormat=decimal&dateFormat=iso`;
        const res = await fetch(url);

        if (res.status === 422) {
          // Sport sem eventos disponíveis — ignorar silenciosamente
          continue;
        }

        if (!res.ok) {
          result.errors.push(`[${sport}] HTTP ${res.status}`);
          continue;
        }

        const events: OddsAPIEvent[] = await res.json();

        for (const event of events) {
          // Ignorar partidas que já começaram
          if (new Date(event.commence_time) <= new Date()) continue;

          // Upsert match
          const { data: match, error: matchError } = await supabaseAdmin
            .from("matches")
            .upsert(
              {
                home_team: event.home_team,
                away_team: event.away_team,
                league_name: event.sport_title,
                league_country: null,
                match_date: event.commence_time,
                status: "not_started",
              },
              { onConflict: "home_team,away_team,match_date", ignoreDuplicates: false },
            )
            .select("id")
            .single();

          if (matchError || !match) {
            result.errors.push(`[${sport}] match upsert: ${matchError?.message}`);
            continue;
          }

          result.matches_upserted++;

          // Desativar odds antigas
          await supabaseAdmin
            .from("odds_cache")
            .update({ is_active: false })
            .eq("match_id", match.id);

          // Pegar bookmaker com mais mercados
          const bookmaker = event.bookmakers.sort(
            (a, b) => b.markets.length - a.markets.length,
          )[0];

          if (!bookmaker) continue;

          for (const market of bookmaker.markets) {
            const marketType = MARKET_MAP[market.key];
            if (!marketType) continue;

            const oddsRows = market.outcomes
              .map((outcome) => {
                const { selection, label } = buildSelectionLabel(
                  marketType,
                  outcome.name,
                  event.home_team,
                  event.away_team,
                  outcome.point,
                );

                return {
                  match_id: match.id,
                  market_type: marketType as never,
                  selection,
                  selection_label: label,
                  odds_value: Math.round(outcome.price * 100) / 100,
                  line: outcome.point ?? null,
                  is_active: true,
                };
              })
              .filter((r) => r.odds_value >= 1.01);

            if (!oddsRows.length) continue;

            const { error: oddsError } = await supabaseAdmin
              .from("odds_cache")
              .insert(oddsRows);

            if (oddsError) {
              result.errors.push(`[${sport}] odds insert: ${oddsError.message}`);
            } else {
              result.odds_upserted += oddsRows.length;
            }
          }
        }
      } catch (err) {
        result.errors.push(`[${sport}] ${String(err)}`);
      }
    }

    return result;
  });

export const syncMatchesAndOdds = syncMatches;
