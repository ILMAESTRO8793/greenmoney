import { pool, initSchema } from './database.js';

// League IDs and current-season year in API-Football's numbering scheme
// (see https://v3.football.api-sports.io/leagues for the full catalog)
const COMPETITIONS = [
  { id: 39, name: 'Premier League', country: 'Inglaterra' },
  { id: 140, name: 'La Liga', country: 'España' },
  { id: 78, name: 'Bundesliga', country: 'Alemania' },
  { id: 135, name: 'Serie A', country: 'Italia' },
  { id: 61, name: 'Ligue 1', country: 'Francia' },
];

const API_BASE = 'https://v3.football.api-sports.io';
const REQUEST_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(path, token, retriesLeft = 2) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': token },
  });
  if (res.status === 429 && retriesLeft > 0) {
    console.log(`Rate limited en ${path}, esperando 10s antes de reintentar (${retriesLeft} intentos restantes)...`);
    await sleep(10000);
    return fetchJson(path, token, retriesLeft - 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`api-football ${res.status} en ${path}: ${body}`);
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`api-football error en ${path}: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

function currentSeasonYear() {
  const now = new Date();
  // European season "2025" typically means Aug 2025 - May 2026, so from
  // January to June we're still inside the season that started the prior year.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

async function importCompetition(comp, token) {
  console.log(`\n=== ${comp.name} (${comp.country}) ===`);

  await pool.query(`
    INSERT INTO leagues (name, country, rho)
    VALUES ($1, $2, -0.08)
    ON CONFLICT (name) DO UPDATE SET country = EXCLUDED.country
  `, [comp.name, comp.country]);
  const { rows: [{ id: resolvedLeagueId }] } = await pool.query(
    `SELECT id FROM leagues WHERE name = $1`,
    [comp.name]
  );

  await pool.query(`DELETE FROM matches WHERE league_id = $1`, [resolvedLeagueId]);
  await pool.query(`DELETE FROM fixtures WHERE league_id = $1`, [resolvedLeagueId]);
  await pool.query(`DELETE FROM analyses WHERE league_id = $1`, [resolvedLeagueId]);
  await pool.query(`DELETE FROM teams WHERE league_id = $1`, [resolvedLeagueId]);

  const season = currentSeasonYear();

  console.log(`Descargando partidos finalizados (temporada ${season})...`);
  await sleep(REQUEST_DELAY_MS);
  const finishedData = await fetchJson(
    `/fixtures?league=${comp.id}&season=${season}&status=FT-AET-PEN`,
    token
  );

  console.log('Descargando partidos programados...');
  await sleep(REQUEST_DELAY_MS);
  let scheduledData = { response: [] };
  try {
    scheduledData = await fetchJson(
      `/fixtures?league=${comp.id}&season=${season}&status=NS-TBD`,
      token
    );
  } catch (err) {
    console.log(`(sin partidos programados para ${comp.name}: ${err.message})`);
  }

  const teamIdCache = new Map();
  async function ensureTeam(name, shortName) {
    if (teamIdCache.has(name)) return teamIdCache.get(name);
    await pool.query(`
      INSERT INTO teams (league_id, name, short_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (league_id, name) DO UPDATE SET short_name = EXCLUDED.short_name
    `, [resolvedLeagueId, name, shortName || name.slice(0, 3).toUpperCase()]);
    const { rows: [{ id }] } = await pool.query(
      `SELECT id FROM teams WHERE league_id = $1 AND name = $2`,
      [resolvedLeagueId, name]
    );
    teamIdCache.set(name, id);
    return id;
  }

  let imported = 0;
  for (const m of finishedData.response || []) {
    const homeGoals = m.goals?.home;
    const awayGoals = m.goals?.away;
    if (homeGoals == null || awayGoals == null) continue;
    const homeId = await ensureTeam(m.teams.home.name, m.teams.home.name.slice(0, 3).toUpperCase());
    const awayId = await ensureTeam(m.teams.away.name, m.teams.away.name.slice(0, 3).toUpperCase());
    await pool.query(`
      INSERT INTO matches (league_id, home_team_id, away_team_id, home_goals, away_goals, played_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [resolvedLeagueId, homeId, awayId, homeGoals, awayGoals, m.fixture.date.slice(0, 10)]);
    imported++;
  }

  console.log(`${comp.name}: ${imported} partidos, ${teamIdCache.size} equipos.`);

  let fixturesImported = 0;
  for (const m of scheduledData.response || []) {
    if (!m.teams?.home?.name || !m.teams?.away?.name || !m.fixture?.date) continue;
    const homeId = await ensureTeam(m.teams.home.name, m.teams.home.name.slice(0, 3).toUpperCase());
    const awayId = await ensureTeam(m.teams.away.name, m.teams.away.name.slice(0, 3).toUpperCase());
    await pool.query(`
      INSERT INTO fixtures (league_id, home_team_id, away_team_id, kickoff_at, external_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [resolvedLeagueId, homeId, awayId, m.fixture.date, String(m.fixture.id)]);
    fixturesImported++;
  }
  console.log(`${comp.name}: ${fixturesImported} partidos programados.`);

  return {
    league: comp.name,
    matches: imported,
    teams: teamIdCache.size,
    fixtures: fixturesImported,
  };
}

export async function importApiFootballLeagues(token) {
  await initSchema();
  const summary = [];
  for (const comp of COMPETITIONS) {
    try {
      const result = await importCompetition(comp, token);
      summary.push(result);
    } catch (err) {
      console.error(`Error importando ${comp.name}:`, err.message);
      summary.push({ league: comp.name, matches: 0, teams: 0, error: err.message });
    }
  }
  console.log('\n=== Resumen de importación ===');
  console.table(summary);
  return summary;
}

const isMain = process.argv[1] && process.argv[1].endsWith('importApiFootball.js');
if (isMain) {
  const token = process.env.API_FOOTBALL_KEY;
  if (!token) {
    console.error('Falta la variable de entorno API_FOOTBALL_KEY.');
    process.exit(1);
  }
  importApiFootballLeagues(token).then(() => process.exit(0));
}