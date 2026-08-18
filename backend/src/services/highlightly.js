import { pool } from '../db/database.js';

const API_BASE = 'https://soccer.highlightly.net';

async function fetchJson(path, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-rapidapi-key': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`highlightly ${res.status} en ${path}: ${body}`);
  }
  return res.json();
}

async function findHighlightlyMatchId(homeTeamName, awayTeamName, kickoffAtIso, token) {
  const date = kickoffAtIso.slice(0, 10);
  const data = await fetchJson(
    `/matches?date=${date}&homeTeamName=${encodeURIComponent(homeTeamName)}`,
    token
  );
  const matches = data.data || [];
  const found = matches.find(m =>
    m.awayTeam?.name?.toLowerCase().includes(awayTeamName.toLowerCase()) ||
    awayTeamName.toLowerCase().includes(m.awayTeam?.name?.toLowerCase() || '\0')
  ) || matches[0];
  return found ? found.id : null;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

function isFresh(cachedAt) {
  if (!cachedAt) return false;
  const cachedTime = cachedAt instanceof Date ? cachedAt.getTime() : new Date(cachedAt).getTime();
  return Date.now() - cachedTime < CACHE_TTL_MS;
}

export async function getMatchPlayerData(fixtureId, homeTeamName, awayTeamName, kickoffAtIso, token) {
  if (!token) {
    return { available: false, reason: 'Highlightly API key no configurada.' };
  }

  const getCached = async (kind) => {
    const { rows: [row] } = await pool.query(
      `SELECT payload, cached_at FROM lineup_cache WHERE fixture_id = $1 AND kind = $2`,
      [fixtureId, kind]
    );
    return row;
  };
  const setCached = async (kind, payload) => {
    await pool.query(`
      INSERT INTO lineup_cache (fixture_id, kind, payload, cached_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (fixture_id, kind) DO UPDATE SET payload = EXCLUDED.payload, cached_at = NOW()
    `, [fixtureId, kind, payload]);
  };

  const cachedLineups = await getCached('lineups');
  const cachedBoxScore = await getCached('boxscore');

  if (cachedLineups && isFresh(cachedLineups.cached_at)) {
    return {
      available: true,
      lineups: JSON.parse(cachedLineups.payload),
      boxScore: cachedBoxScore ? JSON.parse(cachedBoxScore.payload) : null,
    };
  }

  const kickoff = new Date(kickoffAtIso).getTime();
  const now = Date.now();
  const withinWindow = now >= kickoff - 48 * 60 * 60 * 1000 && now <= kickoff + 2 * 60 * 60 * 1000;

  if (!withinWindow) {
    return {
      available: false,
      reason: 'Las alineaciones y estadísticas de jugadores están disponibles desde 48 horas antes del partido.',
    };
  }

  try {
    const matchId = await findHighlightlyMatchId(homeTeamName, awayTeamName, kickoffAtIso, token);
    if (!matchId) {
      return { available: false, reason: 'No se encontró el partido en la fuente de datos de jugadores.' };
    }

    const lineups = await fetchJson(`/lineups/${matchId}`, token);
    await setCached('lineups', JSON.stringify(lineups));

    let boxScore = null;
    try {
      boxScore = await fetchJson(`/box-score/${matchId}`, token);
      await setCached('boxscore', JSON.stringify(boxScore));
    } catch (e) {
      // Box score might not exist yet if the match hasn't started
    }

    return { available: true, lineups, boxScore };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}