import { Router } from 'express';
import { db } from '../db/database.js';
import { runFullAnalysis } from '../services/dixonColes.js';

export const router = Router();

// GET /api/leagues -- list all leagues
router.get('/leagues', (req, res) => {
  const leagues = db.prepare(`SELECT id, name, country, rho, rho_updated_at FROM leagues ORDER BY name`).all();
  res.json(leagues);
});

// GET /api/leagues/:id/teams -- list teams in a league
router.get('/leagues/:id/teams', (req, res) => {
  const teams = db.prepare(`SELECT id, name, short_name FROM teams WHERE league_id = ? ORDER BY name`)
    .all(req.params.id);
  if (teams.length === 0) return res.status(404).json({ error: 'Liga no encontrada o sin equipos.' });
  res.json(teams);
});

// GET /api/leagues/:id/stats -- quick per-team scoring summary
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

// POST /api/analyze  { leagueId, homeTeamId, awayTeamId }
router.post('/analyze', (req, res) => {
  const { leagueId, homeTeamId, awayTeamId } = req.body;

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

  const analysis = runFullAnalysis(Number(homeTeamId), Number(awayTeamId), matches, teamIds);

  const homeName = teams.find(t => t.id === Number(homeTeamId)).name;
  const awayName = teams.find(t => t.id === Number(awayTeamId)).name;

  // Persist the rho estimate on the league record so it's visible/reusable
  db.prepare(`UPDATE leagues SET rho = ?, rho_updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(analysis.rho, leagueId);

  // Save the analysis to history
  const resultJson = JSON.stringify({
    homeName, awayName,
    oneXTwo: analysis.markets.oneXTwo,
    overUnder: analysis.markets.overUnder,
    btts: analysis.markets.btts,
    topScores: analysis.markets.topScores,
  });

  const insert = db.prepare(`
    INSERT INTO analyses (league_id, home_team_id, away_team_id, lambda_home, lambda_away, rho_used, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(leagueId, homeTeamId, awayTeamId, analysis.lambdaHome, analysis.lambdaAway, analysis.rho, resultJson);

  res.json({
    id: insert.lastInsertRowid,
    homeTeam: { id: Number(homeTeamId), name: homeName },
    awayTeam: { id: Number(awayTeamId), name: awayName },
    lambdaHome: analysis.lambdaHome,
    lambdaAway: analysis.lambdaAway,
    rho: analysis.rho,
    sampleSize: analysis.sampleSize,
    leagueAvgHomeGF: analysis.leagueAvgHomeGF,
    leagueAvgAwayGF: analysis.leagueAvgAwayGF,
    matrix: analysis.matrix,
    markets: analysis.markets,
  });
});

// GET /api/history -- recent saved analyses, most recent first
router.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const rows = db.prepare(`
    SELECT a.id, a.lambda_home, a.lambda_away, a.rho_used, a.result_json, a.created_at,
           l.name as league_name,
           ht.name as home_name, at.name as away_name
    FROM analyses a
    JOIN leagues l ON l.id = a.league_id
    JOIN teams ht ON ht.id = a.home_team_id
    JOIN teams at ON at.id = a.away_team_id
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(limit);

  const history = rows.map(r => {
    const parsed = JSON.parse(r.result_json);
    return {
      id: r.id,
      leagueName: r.league_name,
      homeTeam: r.home_name,
      awayTeam: r.away_name,
      lambdaHome: r.lambda_home,
      lambdaAway: r.lambda_away,
      rho: r.rho_used,
      oneXTwo: parsed.oneXTwo,
      createdAt: r.created_at,
    };
  });

  res.json(history);
});

// DELETE /api/history/:id
router.delete('/history/:id', (req, res) => {
  const result = db.prepare(`DELETE FROM analyses WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Análisis no encontrado.' });
  res.json({ deleted: true });
});
