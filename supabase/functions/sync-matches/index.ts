import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY")!;
const FOOTBALL_API_KEY = Deno.env.get("FOOTBALL_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Top leagues mapped to The Odds API sport keys
const SPORTS = [
  { key: "soccer_epl",               name: "Premier League",          country: "England" },
  { key: "soccer_spain_la_liga",      name: "La Liga",                 country: "Spain" },
  { key: "soccer_germany_bundesliga", name: "Bundesliga",              country: "Germany" },
  { key: "soccer_italy_serie_a",      name: "Serie A",                 country: "Italy" },
  { key: "soccer_france_ligue_one",   name: "Ligue 1",                 country: "France" },
  { key: "soccer_uefa_champs_league", name: "UEFA Champions League",   country: "Europe" },
  { key: "soccer_brazil_campeonato",  name: "Brasileirão Série A",     country: "Brazil" },
  { key: "soccer_conmebol_copa_libertadores", name: "Copa Libertadores", country: "South America" },
];

// Normalize team name for fuzzy matching
function normalize(name: string) {
  return name.toLowerCase()
    .replace(/\bfc\b|\bsc\b|\bac\b|\baf\b|\bcd\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Pick best (highest) odds across bookmakers for a given market/selection
function bestOdds(bookmakers: any[], market: string): any[] {
  const map = new Map<string, { price: number; point?: number }>();

  for (const bk of bookmakers) {
    const mk = bk.markets?.find((m: any) => m.key === market);
    if (!mk) continue;
    for (const outcome of mk.outcomes) {
      const key = `${outcome.name}:${outcome.point ?? ""}`;
      const existing = map.get(key);
      if (!existing || outcome.price > existing.price) {
        map.set(key, { price: outcome.price, point: outcome.point });
      }
    }
  }

  return Array.from(map.entries()).map(([k, v]) => ({
    name: k.split(":")[0],
    price: v.price,
    point: v.point,
  }));
}

// ──────────────────────────────────────────────────
// STEP 1: Sync upcoming fixtures + odds via The Odds API
// ──────────────────────────────────────────────────
async function syncOdds(): Promise<{ matches: number; odds: number; errors: string[] }> {
  let matchCount = 0;
  let oddsCount = 0;
  const errors: string[] = [];

  for (const sport of SPORTS) {
    try {
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport.key}/odds/`);
      url.searchParams.set("apiKey", ODDS_API_KEY);
      url.searchParams.set("regions", "eu");
      url.searchParams.set("markets", "h2h,totals,btts");
      url.searchParams.set("oddsFormat", "decimal");
      url.searchParams.set("dateFormat", "iso");

      const res = await fetch(url.toString());
      if (!res.ok) {
        errors.push(`Odds API ${sport.key}: HTTP ${res.status}`);
        continue;
      }
      const events: any[] = await res.json();

      for (const event of events) {
        const matchDate = new Date(event.commence_time);
        // Only process future matches
        if (matchDate <= new Date()) continue;

        // Upsert match
        const { data: matchRow, error: matchErr } = await supabase
          .from("matches")
          .upsert({
            external_id: event.id,
            home_team: event.home_team,
            away_team: event.away_team,
            league_name: sport.name,
            league_country: sport.country,
            match_date: event.commence_time,
            status: "not_started",
          }, { onConflict: "external_id" })
          .select("id, home_team, away_team")
          .single();

        if (matchErr || !matchRow) {
          errors.push(`Match upsert ${event.id}: ${matchErr?.message}`);
          continue;
        }
        matchCount++;

        const oddsRows: any[] = [];

        // h2h → match_winner
        const h2h = bestOdds(event.bookmakers, "h2h");
        for (const o of h2h) {
          let selection: string | null = null;
          let label: string | null = null;

          if (normalize(o.name) === normalize(matchRow.home_team)) {
            selection = "home"; label = `${matchRow.home_team} vence`;
          } else if (normalize(o.name) === normalize(matchRow.away_team)) {
            selection = "away"; label = `${matchRow.away_team} vence`;
          } else if (o.name.toLowerCase().includes("draw")) {
            selection = "draw"; label = "Empate";
          }

          if (selection) {
            oddsRows.push({
              match_id: matchRow.id,
              market_type: "match_winner",
              selection,
              selection_label: label,
              odds_value: o.price,
              line: null,
            });
          }
        }

        // totals → goals_over_under (prefer 2.5 line)
        const totals = bestOdds(event.bookmakers, "totals");
        const preferredLine = 2.5;
        const linesAvailable = [...new Set(totals.filter(o => o.point != null).map(o => o.point))];
        const targetLine = linesAvailable.includes(preferredLine) ? preferredLine : linesAvailable[0];

        for (const o of totals.filter(t => t.point === targetLine)) {
          oddsRows.push({
            match_id: matchRow.id,
            market_type: "goals_over_under",
            selection: o.name.toLowerCase(),
            selection_label: `${o.name} de ${targetLine} gols`,
            odds_value: o.price,
            line: targetLine,
          });
        }

        // btts → both_teams_score
        const btts = bestOdds(event.bookmakers, "btts");
        for (const o of btts) {
          const sel = o.name.toLowerCase() === "yes" ? "yes" : "no";
          oddsRows.push({
            match_id: matchRow.id,
            market_type: "both_teams_score",
            selection: sel,
            selection_label: sel === "yes" ? "Ambas marcam" : "Não ambas marcam",
            odds_value: o.price,
            line: null,
          });
        }

        // Upsert all odds
        for (const odd of oddsRows) {
          const { error: oddErr } = await supabase
            .from("odds_cache")
            .upsert(odd, {
              onConflict: odd.line != null
                ? "match_id,market_type,selection,line"
                : "match_id,market_type,selection",
            });
          if (!oddErr) oddsCount++;
        }
      }
    } catch (e: any) {
      errors.push(`Sport ${sport.key}: ${e.message}`);
    }
  }

  return { matches: matchCount, odds: oddsCount, errors };
}

// ──────────────────────────────────────────────────
// STEP 2: Sync results via API-Football for past matches
// ──────────────────────────────────────────────────
async function syncResults(): Promise<{ updated: number; settled: number; errors: string[] }> {
  let updated = 0;
  let settled = 0;
  const errors: string[] = [];

  // Find matches that should have started but aren't finished
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

  const { data: pendingMatches, error: fetchErr } = await supabase
    .from("matches")
    .select("id, home_team, away_team, match_date, external_id_football")
    .in("status", ["not_started", "in_progress"])
    .lt("match_date", new Date().toISOString())
    .gt("match_date", cutoff.toISOString());

  if (fetchErr || !pendingMatches?.length) {
    return { updated, settled, errors };
  }

  for (const match of pendingMatches) {
    try {
      let fixture: any = null;

      // If we already have a football ID, use it directly
      if (match.external_id_football) {
        const res = await fetch(
          `https://api-football-v1.p.rapidapi.com/v3/fixtures?id=${match.external_id_football}`,
          {
            headers: {
              "X-RapidAPI-Key": FOOTBALL_API_KEY,
              "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
            },
          }
        );
        const data = await res.json();
        fixture = data.response?.[0];
      } else {
        // Search by date
        const matchDate = new Date(match.match_date).toISOString().split("T")[0];
        const res = await fetch(
          `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${matchDate}&status=FT`,
          {
            headers: {
              "X-RapidAPI-Key": FOOTBALL_API_KEY,
              "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
            },
          }
        );
        const data = await res.json();

        // Fuzzy match by team names
        fixture = data.response?.find((f: any) => {
          const dbHome = normalize(match.home_team);
          const dbAway = normalize(match.away_team);
          const apiHome = normalize(f.teams.home.name);
          const apiAway = normalize(f.teams.away.name);
          return (apiHome.includes(dbHome) || dbHome.includes(apiHome)) &&
                 (apiAway.includes(dbAway) || dbAway.includes(apiAway));
        });
      }

      if (!fixture) continue;

      const status = fixture.fixture.status.short;
      const isFinished = ["FT", "AET", "PEN"].includes(status);

      if (!isFinished) {
        // Mark as in_progress
        if (fixture.fixture.status.short === "1H" || fixture.fixture.status.short === "2H" || fixture.fixture.status.short === "HT") {
          await supabase
            .from("matches")
            .update({ status: "in_progress", external_id_football: fixture.fixture.id })
            .eq("id", match.id);
        }
        continue;
      }

      const homeScore = fixture.score.fulltime.home ?? 0;
      const awayScore = fixture.score.fulltime.away ?? 0;

      // Call our settlement RPC — it has admin guard disabled for service_role calls
      // We need to bypass the admin guard here since we're calling from Edge Function
      // So we update the match directly and call settle_pending_bets
      await supabase
        .from("matches")
        .update({
          status: "finished",
          home_score: homeScore,
          away_score: awayScore,
          external_id_football: fixture.fixture.id,
        })
        .eq("id", match.id);

      const { error: settlErr } = await supabase.rpc("settle_pending_bets");
      if (settlErr) {
        errors.push(`Settle after ${match.id}: ${settlErr.message}`);
      } else {
        settled++;
      }
      updated++;
    } catch (e: any) {
      errors.push(`Result for ${match.id}: ${e.message}`);
    }
  }

  return { updated, settled, errors };
}

// ──────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "all";

  try {
    const result: Record<string, any> = {};

    if (action === "odds" || action === "all") {
      result.odds_sync = await syncOdds();
    }

    if (action === "results" || action === "all") {
      result.results_sync = await syncResults();
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
