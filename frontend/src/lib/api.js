// In production, VITE_API_URL points at the deployed backend (e.g.
// https://greenmoney-backend.onrender.com). In development it's unset, so
// requests go to '/api' and are handled by the Vite dev server proxy.
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
  analyze: (leagueId, homeTeamId, awayTeamId) =>
    fetch(`${BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, homeTeamId, awayTeamId }),
    }).then(handle),
  getHistory: (limit = 20) => fetch(`${BASE}/history?limit=${limit}`).then(handle),
  deleteHistory: (id) => fetch(`${BASE}/history/${id}`, { method: 'DELETE' }).then(handle),
};
