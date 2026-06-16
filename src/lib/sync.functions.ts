import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface SyncResult {
  matches_upserted: number;
  odds_upserted: number;
  errors: string[];
}

export const syncMatchesAndOdds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { supabase } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .single();

    if (!profile?.is_admin) {
      throw new Error("Acesso negado.");
    }

    const ODDS_API_KEY = process.env.ODDS_API_KEY ?? process.env.VITE_ODDS_API_KEY;

    const result: SyncResult = { matches_upserted: 0, odds_upserted: 0, errors: [] };

    if (!ODDS_API_KEY) {
      result.errors.push("ODDS_API_KEY não encontrada");
      return result;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sport = "soccer_brazil_campeonato";

    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`;

      result.errors.push(`[DEBUG] Chamando: ${url.replace(ODDS_API_KEY, "***")}`);

      const res = await fetch(url);
      result.errors.push(`[DEBUG] Status: ${res.status}`);

      if (!res.ok) {
        const text = await res.text();
        result.errors.push(`[DEBUG] Body: ${text.slice(0, 200)}`);
        return result;
      }

      const events = await res.json();
      result.errors.push(`[DEBUG] Eventos recebidos: ${events.length}`);

      for (const event of events) {
        if (new Date(event.commence_time) <= new Date()) continue;

        const { data: match, error: matchError } = await supabaseAdmin
          .from("matches")
          .insert({
            home_team: event.home_team,
            away_team: event.away_team,
            league_name: event.sport_title,
            league_country: "Brasil",
            match_date: event.commence_time,
            status: "not_started",
          })
          .select("id")
          .single();

        if (matchError) {
          result.errors.push(`[match error] ${matchError.message}`);
          continue;
        }

        result.matches_upserted++;
      }
    } catch (err) {
      result.errors.push(`[catch] ${String(err)}`);
    }

    return result;
  });

export const syncMatches = syncMatchesAndOdds;
