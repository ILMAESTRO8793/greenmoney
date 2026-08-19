import { pool, initSchema } from './database.js';

const COMPETITIONS = [
  { code: 'PL', name: 'Premier League', country: 'Inglaterra' },
  { code: 'PD', name: 'La Liga', country: 'España' },
  { code: 'BL1', name: 'Bundesliga', country: 'Alemania' },
  { code: 'SA', name: 'Serie A', country: 'Italia' },
  { code: 'FL1', name: 'Ligue 1', country: 'Francia' },
  { code: 'CL', name: 'Champions League', country: 'Europa' },
  { code: 'DED', name: 'Eredivisie', country: 'Países Bajos' },
  { code: 'PPL', name: 'Primeira Liga', country: 'Portugal' },
  { code: 'ELC', name: 'Championship', country: 'Inglaterra' },
  { code: 'BSA', name: 'Brasileirão', country: 'Brasil' },
  { code: 'EC', name: 'Eurocopa', country: 'Europa' },
];

const API_BASE = 'https://api.football-data.org/v4';
const REQUEST_DELAY_MS = 9500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(path, token, retriesLeft = 2) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Auth-Token': token },
  });
  if (res.status === 429 && retriesLeft > 0) {
    const body = await res.text().catch(() => '');
    console.log(`Rate limited en ${path}, esperando 15s antes de reintentar (${retriesLeft} intentos restantes)... ${body}`);
    await sleep(15000);
    return fetchJson(path, token, retriesLeft - 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status} en ${path}: ${body}`);
  }
  return res.json();
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

  console.log('Descargando partidos finalizados...');
  const now = new Date();
  const completedSeasonYear = now.getMonth() >= 6
    ? now.getFullYear() - 1
    : now.getFullYear() - 2;
  const currentSeasonYear = completedSeasonYear + 1;

  // Historical data (prior completed season) seeds the Dixon-Coles model.
  await sleep(REQUEST_DELAY_MS);
  const priorSeasonData = await fetchJson(
    `/competitions/${comp.code}/matches?status=FINISHED&season=${completedSeasonYear}`,
    token
  );

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
  for (const m of priorSeasonData.matches || []) {
    if (m.score?.fullTime?.home == null || m.score?.fullTime?.away == null) continue;
    const homeId = await ensureTeam(m.homeTeam.name, m.homeTeam.tla);
    const awayId = await ensureTeam(m.awayTeam.name, m.awayTeam.tla);
    await pool.query(`
      INSERT INTO matches (league_id, home_team_id, away_team_id, home_goals, away_goals, played_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [resolvedLeagueId, homeId, awayId, m.score.fullTime.home, m.score.fullTime.away, m.utcDate.slice(0, 10)]);
    imported++;
  }

  console.log(`${comp.name}: ${imported} partidos históricos (temporada ${completedSeasonYear}), ${teamIdCache.size} equipos.`);

  // Current season (all statuses) goes into fixtures: played matches get a
  // real score for the standings table, unplayed ones stay as upcoming games.
  console.log(`Descargando calendario completo de la temporada ${currentSeasonYear}...`);
  await sleep(REQUEST_DELAY_MS);
  let currentSeasonAllData = { matches: [] };
  try {
    currentSeasonAllData = await fetchJson(
      `/competitions/${comp.code}/matches?season=${currentSeasonYear}`,
      token
    );
  } catch (err) {
    console.log(`(sin calendario de temporada ${currentSeasonYear} todavía: ${err.message})`);
  }

  let fixturesImported = 0;
  let currentSeasonResultsImported = 0;
  for (const m of currentSeasonAllData.matches || []) {
    if (!m.homeTeam?.name || !m.awayTeam?.name || !m.utcDate) continue;
    const homeId = await ensureTeam(m.homeTeam.name, m.homeTeam.tla);
    const awayId = await ensureTeam(m.awayTeam.name, m.awayTeam.tla);
    const homeGoals = m.score?.fullTime?.home ?? null;
    const awayGoals = m.score?.fullTime?.away ?? null;
    await pool.query(`
      INSERT INTO fixtures (league_id, home_team_id, away_team_id, kickoff_at, external_id, home_goals, away_goals, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (external_id) DO UPDATE SET
        kickoff_at = EXCLUDED.kickoff_at,
        home_goals = EXCLUDED.home_goals,
        away_goals = EXCLUDED.away_goals,
        status = EXCLUDED.status
    `, [resolvedLeagueId, homeId, awayId, m.utcDate, String(m.id), homeGoals, awayGoals, m.status]);
    fixturesImported++;
    if (homeGoals != null && awayGoals != null) currentSeasonResultsImported++;
  }
  console.log(`${comp.name}: ${fixturesImported} partidos de la temporada ${currentSeasonYear} (${currentSeasonResultsImported} ya jugados).`);

  return {
    league: comp.name,
    matches: imported,
    teams: teamIdCache.size,
    fixtures: fixturesImported,
    currentSeasonResults: currentSeasonResultsImported,
  };
}

export async function importEuropeanLeagues(token) {
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

const isMain = process.argv[1] && process.argv[1].endsWith('importEuropeanLeagues.js');
if (isMain) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    console.error('Falta la variable de entorno FOOTBALL_DATA_TOKEN.');
    process.exit(1);
  }
  importEuropeanLeagues(token).then(() => process.exit(0));
}