import { db, initSchema } from './database.js';

const COMPETITIONS = [
  { code: 'PL', name: 'Premier League', country: 'Inglaterra' },
  { code: 'PD', name: 'La Liga', country: 'España' },
  { code: 'BL1', name: 'Bundesliga', country: 'Alemania' },
  { code: 'SA', name: 'Serie A', country: 'Italia' },
  { code: 'FL1', name: 'Ligue 1', country: 'Francia' },
];

const API_BASE = 'https://api.football-data.org/v4';
const REQUEST_DELAY_MS = 6500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Auth-Token': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status} en ${path}: ${body}`);
  }
  return res.json();
}

async function importCompetition(comp, token) {
  const insertLeague = db.prepare(`
    INSERT INTO leagues (name, country, rho)
    VALUES (?, ?, -0.08)
    ON CONFLICT(name) DO UPDATE SET country = excluded.country
  `);
  const getLeagueId = db.prepare(`SELECT id FROM leagues WHERE name = ?`);
  const insertTeam = db.prepare(`
    INSERT INTO teams (league_id, name, short_name)
    VALUES (?, ?, ?)
    ON CONFLICT(league_id, name) DO UPDATE SET short_name = excluded.short_name
  `);
  const getTeamId = db.prepare(`SELECT id FROM teams WHERE league_id = ? AND name = ?`);
  const insertMatch = db.prepare(`
    INSERT INTO matches (league_id, home_team_id, away_team_id, home_goals, away_goals, played_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const clearLeagueMatches = db.prepare(`DELETE FROM matches WHERE league_id = ?`);
  const clearLeagueTeams = db.prepare(`DELETE FROM teams WHERE league_id = ?`);

  console.log(`\n=== ${comp.name} (${comp.country}) ===`);

  insertLeague.run(comp.name, comp.country);
  const resolvedLeagueId = getLeagueId.get(comp.name).id;

  clearLeagueMatches.run(resolvedLeagueId);
  clearLeagueTeams.run(resolvedLeagueId);

  console.log('Descargando partidos finalizados...');
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchJson(`/competitions/${comp.code}/matches?status=FINISHED`, token);

  const teamIdCache = new Map();
  function ensureTeam(name, shortName) {
    if (teamIdCache.has(name)) return teamIdCache.get(name);
    insertTeam.run(resolvedLeagueId, name, shortName || name.slice(0, 3).toUpperCase());
    const id = getTeamId.get(resolvedLeagueId, name).id;
    teamIdCache.set(name, id);
    return id;
  }

  let imported = 0;
  for (const m of data.matches || []) {
    if (m.score?.fullTime?.home == null || m.score?.fullTime?.away == null) continue;
    const homeId = ensureTeam(m.homeTeam.name, m.homeTeam.tla);
    const awayId = ensureTeam(m.awayTeam.name, m.awayTeam.tla);
    insertMatch.run(
      resolvedLeagueId,
      homeId,
      awayId,
      m.score.fullTime.home,
      m.score.fullTime.away,
      m.utcDate.slice(0, 10)
    );
    imported++;
  }

  console.log(`${comp.name}: ${imported} partidos, ${teamIdCache.size} equipos.`);
  return { league: comp.name, matches: imported, teams: teamIdCache.size };
}

export async function importEuropeanLeagues(token) {
  initSchema();
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