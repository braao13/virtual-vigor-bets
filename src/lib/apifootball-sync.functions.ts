import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// API-Football — Resultados e estatísticas reais
// ============================================================

const APIFOOTBALL_BASE = "https://v3.football.api-sports.io";

// IDs das ligas no API-Football
const LEAGUE_IDS = [
  71,   // Brasileirão Série A
  72,   // Brasileirão Série B
  73,   // Copa do Brasil
  2,    // UEFA Champions League
  39,   // Premier League
  140,  // La Liga
  78,   // Bundesliga
  135,  // Serie A
  61,   // Ligue 1
  13,   // CONMEBOL Libertadores
];

interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    fulltime: { home: number | null; away: number | null };
  };
}

interface ApiFootballStatistics {
  team: { id: number; name: string };
  statistics: { type: string; value: number | string | null }[];
}

async function fetchFixtures(leagueId: number, apiKey: string): Promise<ApiFootballFixture[]> {
  const today = new Date().toISOString().split("T")[0];
  const url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=2025&from=${today}&to=${getDatePlusDays(7)}`;

  const res = await fetch(url, {
    headers: {
      "x-apisports-key": apiKey,
    },
  });

  if (!res.ok) throw new Error(`API-Football error ${res.status}`);
  const data = await res.json();
  return data.response ?? [];
}

async function fetchFixtureStatistics(fixtureId: number, apiKey: string): Promise<ApiFootballStatistics[]> {
  const url = `${APIFOOTBALL_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.response ?? [];
}

async function fetchFinishedFixtures(leagueId: number, apiKey: string): Promise<ApiFootballFixture[]> {
  const yesterday = getDatePlusDays(-1);
  const today = new Date().toISOString().split("T")[0];
  const url = `${APIFOOTBALL_BASE}/fixtures?league=${leagueId}&season=2025&from=${yesterday}&to=${today}&status=FT`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.response ?? [];
}

function getDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function getStatValue(stats: { type: string; value: number | string | null }[], type: string): number {
  const stat = stats.find((s) => s.type === type);
  if (!stat || stat.value === null) return 0;
  return typeof stat.value === "number" ? stat.value : parseInt(String(stat.value), 10) || 0;
}

// ============================================================
// Sync partidas futuras do API-Football → matches + odds_cache
// ============================================================
export const syncApiFootballFixtures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY não configurada");

    let totalSynced = 0;
    const errors: string[] = [];

    for (const leagueId of LEAGUE_IDS) {
      try {
        const fixtures = await fetchFixtures(leagueId, apiKey);

        for (const fixture of fixtures) {
          const status = fixture.fixture.status.short;
          // Apenas não iniciados
          if (!["NS", "TBD"].includes(status)) continue;

          const { error } = await supabaseAdmin
            .from("matches")
            .upsert({
              external_id: `apifootball_${fixture.fixture.id}`,
              home_team: fixture.teams.home.name,
              away_team: fixture.teams.away.name,
              league_name: fixture.league.name,
              league_country: fixture.league.country,
              home_team_logo_url: fixture.teams.home.logo,
              away_team_logo_url: fixture.teams.away.logo,
              match_date: fixture.fixture.date,
              status: "not_started",
            }, { onConflict: "external_id", ignoreDuplicates: false });

          if (!error) totalSynced++;
          else errors.push(`Fixture ${fixture.fixture.id}: ${error.message}`);
        }
      } catch (err) {
        errors.push(`League ${leagueId}: ${(err as Error).message}`);
      }
    }

    return { totalSynced, errors };
  });

// ============================================================
// Sync resultados finalizados → atualizar matches + liquidar apostas
// ============================================================
export const syncApiFootballResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY não configurada");

    let totalUpdated = 0;
    let totalSettled = 0;
    const errors: string[] = [];

    for (const leagueId of LEAGUE_IDS) {
      try {
        const fixtures = await fetchFinishedFixtures(leagueId, apiKey);

        for (const fixture of fixtures) {
          const externalId = `apifootball_${fixture.fixture.id}`;

          // Buscar match no banco
          const { data: match } = await supabaseAdmin
            .from("matches")
            .select("id, status")
            .eq("external_id", externalId)
            .maybeSingle();

          if (!match || match.status === "finished") continue;

          // Buscar estatísticas do jogo
          const stats = await fetchFixtureStatistics(fixture.fixture.id, apiKey);
          const homeStats = stats.find((s) => s.team.name === fixture.teams.home.name)?.statistics ?? [];
          const awayStats = stats.find((s) => s.team.name === fixture.teams.away.name)?.statistics ?? [];

          const homeScore = fixture.score.fulltime.home ?? 0;
          const awayScore = fixture.score.fulltime.away ?? 0;
          const homeCorners = getStatValue(homeStats, "Corner Kicks");
          const awayCorners = getStatValue(awayStats, "Corner Kicks");
          const homeCards = getStatValue(homeStats, "Yellow Cards") + getStatValue(homeStats, "Red Cards");
          const awayCards = getStatValue(awayStats, "Yellow Cards") + getStatValue(awayStats, "Red Cards");
          const homeShots = getStatValue(homeStats, "Total Shots");
          const awayShots = getStatValue(awayStats, "Total Shots");
          const homeShotsOnTarget = getStatValue(homeStats, "Shots on Goal");
          const awayShotsOnTarget = getStatValue(awayStats, "Shots on Goal");

          // Atualizar match com resultado real
          const { error: updateError } = await supabaseAdmin
            .from("matches")
            .update({
              status: "finished",
              home_score: homeScore,
              away_score: awayScore,
              home_corners: homeCorners,
              away_corners: awayCorners,
              home_cards: homeCards,
              away_cards: awayCards,
              home_shots: homeShots,
              away_shots: awayShots,
              home_shots_on_target: homeShotsOnTarget,
              away_shots_on_target: awayShotsOnTarget,
            })
            .eq("id", match.id);

          if (updateError) {
            errors.push(`Update match ${match.id}: ${updateError.message}`);
            continue;
          }

          totalUpdated++;
        }

        // Liquidar apostas após atualizar resultados
        const { data: settlementResult, error: settleError } = await supabaseAdmin
          .rpc("settle_pending_bets");

        if (settleError) {
          errors.push(`Settlement error: ${settleError.message}`);
        } else if (settlementResult) {
          totalSettled += (settlementResult as { settled: number }).settled ?? 0;
        }

        // Refresh rankings após liquidação
        await supabaseAdmin.rpc("refresh_user_rankings");

      } catch (err) {
        errors.push(`League ${leagueId}: ${(err as Error).message}`);
      }
    }

    return { totalUpdated, totalSettled, errors };
  });

// ============================================================
// Sync manual de um jogo específico por fixture_id
// ============================================================
export const syncSingleFixture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ fixture_id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error("API_FOOTBALL_KEY não configurada");

    const url = `${APIFOOTBALL_BASE}/fixtures?id=${data.fixture_id}`;
    const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
    if (!res.ok) throw new Error(`API-Football error ${res.status}`);
    const json = await res.json();
    const fixture: ApiFootballFixture = json.response?.[0];
    if (!fixture) throw new Error("Fixture não encontrada");

    const stats = await fetchFixtureStatistics(data.fixture_id, apiKey);
    const homeStats = stats.find((s) => s.team.name === fixture.teams.home.name)?.statistics ?? [];
    const awayStats = stats.find((s) => s.team.name === fixture.teams.away.name)?.statistics ?? [];

    const externalId = `apifootball_${fixture.fixture.id}`;
    const { data: match } = await supabaseAdmin
      .from("matches")
      .select("id")
      .eq("external_id", externalId)
      .maybeSingle();

    if (!match) throw new Error("Partida não encontrada no banco");

    await supabaseAdmin.from("matches").update({
      status: fixture.fixture.status.short === "FT" ? "finished" : "live",
      home_score: fixture.score.fulltime.home ?? fixture.goals.home ?? 0,
      away_score: fixture.score.fulltime.away ?? fixture.goals.away ?? 0,
      home_corners: getStatValue(homeStats, "Corner Kicks"),
      away_corners: getStatValue(awayStats, "Corner Kicks"),
      home_cards: getStatValue(homeStats, "Yellow Cards") + getStatValue(homeStats, "Red Cards"),
      away_cards: getStatValue(awayStats, "Yellow Cards") + getStatValue(awayStats, "Red Cards"),
      home_shots: getStatValue(homeStats, "Total Shots"),
      away_shots: getStatValue(awayStats, "Total Shots"),
      home_shots_on_target: getStatValue(homeStats, "Shots on Goal"),
      away_shots_on_target: getStatValue(awayStats, "Shots on Goal"),
    }).eq("id", match.id);

    const { data: settlement } = await supabaseAdmin.rpc("settle_pending_bets");
    await supabaseAdmin.rpc("refresh_user_rankings");

    return { match_id: match.id, settlement };
  });
