import { db } from '../db/database.js';

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
  return Date.now() - new Date(cachedAt + 'Z').getTime() < CACHE_TTL_MS;
}

export async function getMatchPlayerData(fixtureId, homeTeamName, awayTeamName, kickoffAtIso, token) {
  if (!token) {
    return { available: false, reason: 'Highlightly API key no configurada.' };
  }

  const getCached = db.prepare(`
    SELECT payload, cached_at FROM lineup_cache WHERE fixture_id = ? AND kind = ?
  `);
  const setCached = db.prepare(`
    INSERT INTO lineup_cache (fixture_id, kind, payload, cached_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(fixture_id, kind) DO UPDATE SET payload = excluded.payload, cached_at = CURRENT_TIMESTAMP
  `);

  const cachedLineups = getCached.get(fixtureId, 'lineups');
  const cachedBoxScore = getCached.get(fixtureId, 'boxscore');

  if (cachedLineups && isFresh(cachedLineups.cached_at)) {
    return {
      available: true,
      lineups: JSON.parse(cachedLineups.payload),
      boxScore: cachedBoxScore ? JSON.parse(cachedBoxScore.payload) : null,
    };
  }

  const kickoff = new Date(kickoffAtIso).getTime();
  const now = Date.now();
  const withinWindow = now >= kickoff - 2 * 60 * 60 * 1000 && now <= kickoff + 2 * 60 * 60 * 1000;

  if (!withinWindow) {
    return {
      available: false,
      reason: 'Las alineaciones se publican entre 40 minutos antes y hasta 2 horas después del partido.',
    };
  }

  try {
    const matchId = await findHighlightlyMatchId(homeTeamName, awayTeamName, kickoffAtIso, token);
    if (!matchId) {
      return { available: false, reason: 'No se encontró el partido en la fuente de datos de jugadores.' };
    }

    const lineups = await fetchJson(`/lineups/${matchId}`, token);
    setCached.run(fixtureId, 'lineups', JSON.stringify(lineups));

    let boxScore = null;
    try {
      boxScore = await fetchJson(`/box-score/${matchId}`, token);
      setCached.run(fixtureId, 'boxscore', JSON.stringify(boxScore));
    } catch (e) {
      // Box score might not exist yet if the match hasn't started
    }

    return { available: true, lineups, boxScore };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}