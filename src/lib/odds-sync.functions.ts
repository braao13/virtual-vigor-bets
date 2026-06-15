import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// TheOddsAPI — Sync de partidas e odds reais
// ============================================================

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Ligas suportadas (sport keys da TheOddsAPI)
const SUPPORTED_SPORTS = [
  "soccer_brazil_campeonato",       // Brasileirão
  "soccer_uefa_champs_league",      // Champions League
  "soccer_epl",                     // Premier League
  "soccer_spain_la_liga",           // La Liga
  "soccer_germany_bundesliga",      // Bundesliga
  "soccer_italy_serie_a",           // Serie A
  "soccer_france_ligue_one",        // Ligue 1
  "soccer_brazil_copa_do_brasil",   // Copa do Brasil
  "soccer_conmebol_copa_libertadores", // Libertadores
];

// Mapeamento de mercados TheOddsAPI → nosso market_type
const MARKET_MAP: Record<string, string> = {
  h2h: "match_winner",
  spreads: "double_chance",
  totals: "goals_over_under",
};

// Mapeamento de outcomes para selection
function mapOutcome(market: string, outcomeName: string, homeTeam: string, awayTeam: string): {
  selection: string;
  selection_label: string;
} | null {
  if (market === "match_winner") {
    if (outcomeName === homeTeam) return { selection: "home", selection_label: homeTeam };
    if (outcomeName === awayTeam) return { selection: "away", selection_label: awayTeam };
    if (outcomeName === "Draw") return { selection: "draw", selection_label: "Empate" };
  }
  if (market === "goals_over_under") {
    if (outcomeName.startsWith("Over")) return { selection: "over", selection_label: outcomeName };
    if (outcomeName.startsWith("Under")) return { selection: "under", selection_label: outcomeName };
  }
  return null;
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: {
    key: string;
    markets: {
      key: string;
      outcomes: { name: string; price: number; point?: number }[];
    }[];
  }[];
}

async function fetchOddsApiEvents(sport: string, apiKey: string): Promise<OddsApiEvent[]> {
  const url = `${ODDS_API_BASE}/sports/${sport}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 422) return []; // Sport sem eventos
    throw new Error(`TheOddsAPI error ${res.status} for ${sport}`);
  }
  return res.json();
}

export const syncOddsApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apiKey = process.env.THE_ODDS_API_KEY;
    if (!apiKey) throw new Error("THE_ODDS_API_KEY não configurada");

    let totalMatches = 0;
    let totalOdds = 0;
    const errors: string[] = [];

    for (const sport of SUPPORTED_SPORTS) {
      try {
        const events = await fetchOddsApiEvents(sport, apiKey);

        for (const event of events) {
          // Ignorar partidas que começam em mais de 7 dias
          const commenceDate = new Date(event.commence_time);
          const daysUntil = (commenceDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysUntil > 7) continue;

          // Upsert partida
          const { data: match, error: matchError } = await supabaseAdmin
            .from("matches")
            .upsert({
              external_id: event.id,
              home_team: event.home_team,
              away_team: event.away_team,
              league_name: event.sport_title,
              match_date: event.commence_time,
              status: "not_started",
            }, { onConflict: "external_id", ignoreDuplicates: false })
            .select("id, status")
            .maybeSingle();

          if (matchError || !match) {
            errors.push(`Match upsert error: ${matchError?.message}`);
            continue;
          }

          // Não atualizar odds de jogos já iniciados ou finalizados
          if (match.status !== "not_started") continue;

          totalMatches++;

          // Processar odds — pegar primeiro bookmaker disponível
          const bookmaker = event.bookmakers?.[0];
          if (!bookmaker) continue;

          const oddsToUpsert: {
            match_id: string;
            market_type: string;
            selection: string;
            selection_label: string;
            odds_value: number;
            line: number | null;
            is_active: boolean;
          }[] = [];

          for (const market of bookmaker.markets) {
            const marketType = MARKET_MAP[market.key];
            if (!marketType) continue;

            for (const outcome of market.outcomes) {
              const mapped = mapOutcome(marketType, outcome.name, event.home_team, event.away_team);
              if (!mapped) continue;

              oddsToUpsert.push({
                match_id: match.id,
                market_type: marketType,
                selection: mapped.selection,
                selection_label: mapped.selection_label,
                odds_value: outcome.price,
                line: outcome.point ?? null,
                is_active: true,
              });
            }
          }

          // Desativar odds antigas desta partida
          await supabaseAdmin
            .from("odds_cache")
            .update({ is_active: false })
            .eq("match_id", match.id);

          // Inserir novas odds
          if (oddsToUpsert.length > 0) {
            const { error: oddsError } = await supabaseAdmin
              .from("odds_cache")
              .insert(oddsToUpsert);

            if (oddsError) {
              errors.push(`Odds insert error for ${match.id}: ${oddsError.message}`);
            } else {
              totalOdds += oddsToUpsert.length;
            }
          }
        }
      } catch (err) {
        errors.push(`Sport ${sport}: ${(err as Error).message}`);
      }
    }

    return { totalMatches, totalOdds, errors };
  });

// ============================================================
// Sync de resultados — buscar jogos finalizados e atualizar
// ============================================================
export const syncMatchResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apiKey = process.env.THE_ODDS_API_KEY;
    if (!apiKey) throw new Error("THE_ODDS_API_KEY não configurada");

    // Buscar partidas pendentes de liquidação (não iniciadas mas com data passada)
    const { data: pendingMatches } = await supabaseAdmin
      .from("matches")
      .select("id, external_id, match_date")
      .eq("status", "not_started")
      .lt("match_date", new Date().toISOString());

    if (!pendingMatches?.length) return { updated: 0 };

    let updated = 0;

    for (const match of pendingMatches) {
      // Marcar como "live" enquanto busca resultado
      await supabaseAdmin
        .from("matches")
        .update({ status: "live" })
        .eq("id", match.id);
      updated++;
    }

    // Liquidar apostas dos jogos agora marcados como live → serão liquidados
    // manualmente ou via API-Football quando resultados chegarem
    return { updated };
  });
