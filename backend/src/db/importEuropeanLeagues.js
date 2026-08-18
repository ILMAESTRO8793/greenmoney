import { db, initSchema } from './database.js';

initSchema();

// football-data.org v4 — free tier: 10 req/min, includes these top leagues.
// Docs: https://docs.football-data.org/general/v4/index.html
const COMPETITIONS = [
  { code: 'PL', name: 'Premier League', country: 'Inglaterra' },
  { code: 'PD', name: 'La Liga', country: 'España' },
  { code: 'BL1', name: 'Bundesliga', country: 'Alemania' },
  { code: 'SA', name: 'Serie A', country: 'Italia' },
  { code: 'FL1', name: 'Ligue 1', country: 'Francia' },
];

const API_BASE = 'https://api.football-data.org/v4';
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;

if (!TOKEN) {
  console.error('Falta la variable de entorno FOOTBALL_DATA_TOKEN con tu API key de football-data.org.');
  console.error('Ejecuta: FOOTBALL_DATA_TOKEN=tu_token node src/db/importEuropeanLeagues.js');
  process.exit(1);
}

// Free tier is rate-limited to 10 requests/minute -- space calls out safely.
const REQUEST_DELAY_MS = 6500;
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Auth-Token': TOKEN },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`football-data.org ${res.status} en ${path}: ${body}`);
  }
  return res.json();
}

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

async function importCompetition(comp) {
  console.log(`\n=== ${comp.name} (${comp.country}) ===`);

  const leagueId = insertLeague.run(comp.name, comp.country).lastInsertRowid
    || getLeagueId.get(comp.name).id;
  const resolvedLeagueId = getLeagueId.get(comp.name).id;

  clearLeagueMatches.run(resolvedLeagueId);
  clearLeagueTeams.run(resolvedLeagueId);

  console.log('Descargando partidos finalizados...');
  await sleep(REQUEST_DELAY_MS);
  const data = await fetchJson(`/competitions/${comp.code}/matches?status=FINISHED`);

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

async function run() {
  const summary = [];
  for (const comp of COMPETITIONS) {
    try {
      const result = await importCompetition(comp);
      summary.push(result);
    } catch (err) {
      console.error(`Error importando ${comp.name}:`, err.message);
      summary.push({ league: comp.name, matches: 0, teams: 0, error: err.message });
    }
  }

  console.log('\n=== Resumen de importación ===');
  console.table(summary);
}

run();