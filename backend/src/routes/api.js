import { Router } from 'express';
import { db } from '../db/database.js';
import { runFullAnalysis } from '../services/dixonColes.js';
import { getMatchPlayerData } from '../services/highlightly.js';

export const router = Router();

router.get('/leagues', (req, res) => {
  const leagues = db.prepare(`SELECT id, name, country, rho, rho_updated_at FROM leagues ORDER BY name`).all();
  res.json(leagues);
});

router.get('/leagues/:id/teams', (req, res) => {
  const teams = db.prepare(`SELECT id, name, short_name FROM teams WHERE league_id = ? ORDER BY name`)
    .all(req.params.id);
  if (teams.length === 0) return res.status(404).json({ error: 'Liga no encontrada o sin equipos.' });
  res.json(teams);
});

router.get('/leagues/:id/stats', (req, res) => {
  const leagueId = req.params.id;
  const teams = db.prepare(`SELECT id, name, short_name FROM teams WHERE league_id = ?`).all(leagueId);
  if (teams.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });

  const stats = teams.map(t => {
    const home = db.prepare(`
      SELECT COUNT(*) as played, COALESCE(SUM(home_goals),0) as gf, COALESCE(SUM(away_goals),0) as ga
      FROM matches WHERE league_id = ? AND home_team_id = ?
    `).get(leagueId, t.id);
    const away = db.prepare(`
      SELECT COUNT(*) as played, COALESCE(SUM(away_goals),0) as gf, COALESCE(SUM(home_goals),0) as ga
      FROM matches WHERE league_id = ? AND away_team_id = ?
    `).get(leagueId, t.id);
    return { ...t, home, away };
  });

  res.json(stats);
});

router.get('/leagues/:id/fixtures', (req, res) => {
  const leagueId = req.params.id;
  const fixtures = db.prepare(`
    SELECT f.id, f.kickoff_at,
           ht.id as home_team_id, ht.name as home_team_name,
           at.id as away_team_id, at.name as away_team_name
    FROM fixtures f
    JOIN teams ht ON ht.id = f.home_team_id
    JOIN teams at ON at.id = f.away_team_id
    WHERE f.league_id = ?
    ORDER BY f.kickoff_at ASC
  `).all(leagueId);
  res.json(fixtures);
});

router.get('/fixtures/:id/players', async (req, res) => {
  const fixture = db.prepare(`
    SELECT f.id, f.kickoff_at,
           ht.name as home_team_name, at.name as away_team_name
    FROM fixtures f
    JOIN teams ht ON ht.id = f.home_team_id
    JOIN teams at ON at.id = f.away_team_id
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fixture) return res.status(404).json({ error: 'Partido no encontrado.' });

  const token = process.env.HIGHLIGHTLY_API_KEY;
  const result = await getMatchPlayerData(
    fixture.id,
    fixture.home_team_name,
    fixture.away_team_name,
    fixture.kickoff_at,
    token
  );

  res.json(result);
});

router.post('/analyze', (req, res) => {
  const { leagueId, homeTeamId, awayTeamId, fixtureId } = req.body;

  if (!leagueId || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: 'Se requieren leagueId, homeTeamId y awayTeamId.' });
  }
  if (homeTeamId === awayTeamId) {
    return res.status(400).json({ error: 'El equipo local y visitante deben ser distintos.' });
  }

  const teams = db.prepare(`SELECT id, name FROM teams WHERE league_id = ?`).all(leagueId);
  const teamIds = teams.map(t => t.id);
  if (!teamIds.includes(Number(homeTeamId)) || !teamIds.includes(Number(awayTeamId))) {
    return res.status(404).json({ error: 'Uno o ambos equipos no pertenecen a esta liga.' });
  }

  const matches = db.prepare(`SELECT * FROM matches WHERE league_id = ?`).all(leagueId);
  if (matches.length < 10) {
    return res.status(422).json({ error: 'No hay suficiente historial de partidos en esta liga para generar un análisis confiable.' });
  }

  let kickoffAt = null;
  if (fixtureId) {
    const fixture = db.prepare(`SELECT kickoff_at FROM fixtures WHERE id = ? AND league_id = ?`)
      .get(fixtureId, leagueId);
    if (fixture) kickoffAt = fixture.kickoff_at;
  }

  const analysis = runFullAnalysis(Number(homeTeamId), Number(awayTeamId), matches, teamIds);

  const homeName = teams.find(t => t.id === Number(homeTeamId)).name;
  const awayName = teams.find(t => t.id === Number(awayTeamId)).name;

  db.prepare(`UPDATE leagues SET rho = ?, rho_updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(analysis.rho, leagueId);

  const resultJson = JSON.stringify({