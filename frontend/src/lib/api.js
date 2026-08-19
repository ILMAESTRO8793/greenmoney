const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

export const api = {
  getLeagues: () => fetch(`${BASE}/leagues`).then(handle),
  getTeams: (leagueId) => fetch(`${BASE}/leagues/${leagueId}/teams`).then(handle),
  getFixtures: (leagueId) => fetch(`${BASE}/leagues/${leagueId}/fixtures`).then(handle),
  getStandings: (leagueId) => fetch(`${BASE}/leagues/${leagueId}/standings`).then(handle),
  getFixturePlayers: (fixtureId) => fetch(`${BASE}/fixtures/${fixtureId}/players`).then(handle),
  analyze: (leagueId, homeTeamId, awayTeamId, fixtureId) =>
    fetch(`${BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, homeTeamId, awayTeamId, fixtureId }),
    }).then(handle),
  getHistory: (limit = 20) => fetch(`${BASE}/history?limit=${limit}`).then(handle),
  deleteHistory: (id) => fetch(`${BASE}/history/${id}`, { method: 'DELETE' }).then(handle),
};