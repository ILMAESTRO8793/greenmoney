import { Router } from 'express';
import { pool } from '../db/database.js';
import { runFullAnalysis } from '../services/dixonColes.js';
import { getMatchPlayerData } from '../services/highlightly.js';

export const router = Router();

const RECENT_FORM_LIMIT = 10;

async function getRecentForm(teamId, leagueId) {
  const { rows } = await pool.query(`
    SELECT home_team_id, away_team_id, home_goals, away_goals, played_at
    FROM matches
    WHERE league_id = $1 AND (home_team_id = $2 OR away_team_id = $2)
    ORDER BY played_at DESC
    LIMIT $3
  `, [leagueId, teamId, RECENT_FORM_LIMIT]);

  const played = rows.length;
  if (played === 0) {
    return {
      played: 0,
      goalsFor: 0, goalsAgainst: 0,
      avgGoalsFor: 0, avgGoalsAgainst: 0,
      bttsYes: 0, bttsPct: 0,
      over15: 0, over25: 0, over35: 0,
      over15Pct: 0, over25Pct: 0, over35Pct: 0,
      results: [],
    };
  }

  let goalsFor = 0, goalsAgainst = 0, bttsYes = 0, over15 = 0, over25 = 0, over35 = 0;
  const results = [];

  for (const m of rows) {
    const isHome = m.home_team_id === teamId;
    const gf = isHome ? m.home_goals : m.away_goals;
    const ga = isHome ? m.away_goals : m.home_goals;
    const total = m.home_goals + m.away_goals;

    goalsFor += gf;
    goalsAgainst += ga;
    if (m.home_goals > 0 && m.away_goals > 0) bttsYes++;
    if (total > 1.5) over15++;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;

    results.push({
      gf, ga,
      result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
      playedAt: m.played_at,
    });
  }

  return {
    played,
    goalsFor, goalsAgainst,
    avgGoalsFor: goalsFor / played,
    avgGoalsAgainst: goalsAgainst / played,
    bttsYes, bttsPct: bttsYes / played,
    over15, over25, over35,
    over15Pct: over15 / played,
    over25Pct: over25 / played,
    over35Pct: over35 / played,
    results,
  };
}

router.get('/leagues', async (req, res) => {
  const { rows } = await pool.query(`SELECT id, name, country, rho, rho_updated_at FROM leagues ORDER BY name`);
  res.json(rows);
});

router.get('/leagues/:id/teams', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, short_name FROM teams WHERE league_id = $1 ORDER BY name`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada o sin equipos.' });
  res.json(rows);
});

router.get('/leagues/:id/stats', async (req, res) => {
  const leagueId = req.params.id;
  const { rows: teams } = await pool.query(
    `SELECT id, name, short_name FROM teams WHERE league_id = $1`,
    [leagueId]
  );
  if (teams.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });

  const stats = await Promise.all(teams.map(async t => {
    const { rows: [home] } = await pool.query(`
      SELECT COUNT(*) as played, COALESCE(SUM(home_goals),0) as gf, COALESCE(SUM(away_goals),0) as ga
      FROM matches WHERE league_id = $1 AND home_team_id = $2
    `, [leagueId, t.id]);
    const { rows: [away] } = await pool.query(`
      SELECT COUNT(*) as played, COALESCE(SUM(away_goals),0) as gf, COALESCE(SUM(home_goals),0) as ga
      FROM matches WHERE league_id = $1 AND away_team_id = $2
    `, [leagueId, t.id]);
    return { ...t, home, away };
  }));

  res.json(stats);
});

router.get('/leagues/:id/standings', async (req, res) => {
  const leagueId = req.params.id;

  const { rows: teams } = await pool.query(
    `SELECT id, name, short_name FROM teams WHERE league_id = $1`,
    [leagueId]
  );
  if (teams.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });

  const { rows: matches } = await pool.query(
    `SELECT home_team_id, away_team_id, home_goals, away_goals FROM matches WHERE league_id = $1`,
    [leagueId]
  );

  const table = {};
  for (const t of teams) {
    table[t.id] = {
      id: t.id, name: t.name, shortName: t.short_name,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
    };
  }

  for (const m of matches) {
    const home = table[m.home_team_id];
    const away = table[m.away_team_id];
    if (!home || !away) continue;

    home.played++; away.played++;
    home.goalsFor += m.home_goals; home.goalsAgainst += m.away_goals;
    away.goalsFor += m.away_goals; away.goalsAgainst += m.home_goals;

    if (m.home_goals > m.away_goals) {
      home.won++; home.points += 3;
      away.lost++;
    } else if (m.home_goals < m.away_goals) {
      away.won++; away.points += 3;
      home.lost++;
    } else {
      home.drawn++; away.drawn++;
      home.points++; away.points++;
    }
  }

  const standings = Object.values(table).map(t => ({
    ...t,
    goalDiff: t.goalsFor - t.goalsAgainst,
  }));

  standings.sort((a, b) =>
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsFor - a.goalsFor ||
    a.name.localeCompare(b.name)
  );

  standings.forEach((t, i) => { t.position = i + 1; });

  res.json(standings);
});

router.get('/leagues/:id/fixtures', async (req, res) => {
  const leagueId = req.params.id;
  const { rows } = await pool.query(`
    SELECT f.id, f.kickoff_at,
           ht.id as home_team_id, ht.name as home_team_name,
           at.id as away_team_id, at.name as away_team_name
    FROM fixtures f
    JOIN teams ht ON ht.id = f.home_team_id
    JOIN teams at ON at.id = f.away_team_id
    WHERE f.league_id = $1
    ORDER BY f.kickoff_at ASC
  `, [leagueId]);
  res.json(rows);
});

router.get('/fixtures/:id/players', async (req, res) => {
  const { rows: [fixture] } = await pool.query(`
    SELECT f.id, f.kickoff_at,
           ht.name as home_team_name, at.name as away_team_name
    FROM fixtures f
    JOIN teams ht ON ht.id = f.home_team_id
    JOIN teams at ON at.id = f.away_team_id
    WHERE f.id = $1
  `, [req.params.id]);

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

router.post('/analyze', async (req, res) => {
  const { leagueId, homeTeamId, awayTeamId, fixtureId } = req.body;

  if (!leagueId || !homeTeamId || !awayTeamId) {
    return res.status(400).json({ error: 'Se requieren leagueId, homeTeamId y awayTeamId.' });
  }
  if (homeTeamId === awayTeamId) {
    return res.status(400).json({ error: 'El equipo local y visitante deben ser distintos.' });
  }

  const { rows: teams } = await pool.query(`SELECT id, name FROM teams WHERE league_id = $1`, [leagueId]);
  const teamIds = teams.map(t => t.id);
  if (!teamIds.includes(Number(homeTeamId)) || !teamIds.includes(Number(awayTeamId))) {
    return res.status(404).json({ error: 'Uno o ambos equipos no pertenecen a esta liga.' });
  }

  const { rows: matches } = await pool.query(`SELECT * FROM matches WHERE league_id = $1`, [leagueId]);
  if (matches.length < 10) {
    return res.status(422).json({ error: 'No hay suficiente historial de partidos en esta liga para generar un análisis confiable.' });
  }

  let kickoffAt = null;
  if (fixtureId) {
    const { rows: [fixture] } = await pool.query(
      `SELECT kickoff_at FROM fixtures WHERE id = $1 AND league_id = $2`,
      [fixtureId, leagueId]
    );
    if (fixture) kickoffAt = fixture.kickoff_at;
  }

  const analysis = runFullAnalysis(Number(homeTeamId), Number(awayTeamId), matches, teamIds);

  const homeName = teams.find(t => t.id === Number(homeTeamId)).name;
  const awayName = teams.find(t => t.id === Number(awayTeamId)).name;

  const [homeForm, awayForm] = await Promise.all([
    getRecentForm(Number(homeTeamId), leagueId),
    getRecentForm(Number(awayTeamId), leagueId),
  ]);

  await pool.query(`UPDATE leagues SET rho = $1, rho_updated_at = NOW() WHERE id = $2`, [analysis.rho, leagueId]);

  const resultJson = JSON.stringify({
    homeName, awayName,
    oneXTwo: analysis.markets.oneXTwo,
    overUnder: analysis.markets.overUnder,
    btts: analysis.markets.btts,
    topScores: analysis.markets.topScores,
    kickoffAt,
  });

  const { rows: [insert] } = await pool.query(`
    INSERT INTO analyses (league_id, home_team_id, away_team_id, lambda_home, lambda_away, rho_used, result_json)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [leagueId, homeTeamId, awayTeamId, analysis.lambdaHome, analysis.lambdaAway, analysis.rho, resultJson]);

  res.json({
    id: insert.id,
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
    kickoffAt,
    homeForm,
    awayForm,
  });
});

router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const { rows } = await pool.query(`
    SELECT a.id, a.lambda_home, a.lambda_away, a.rho_used, a.result_json, a.created_at,
           l.name as league_name,
           ht.name as home_name, at.name as away_name
    FROM analyses a
    JOIN leagues l ON l.id = a.league_id
    JOIN teams ht ON ht.id = a.home_team_id
    JOIN teams at ON at.id = a.away_team_id
    ORDER BY a.created_at DESC
    LIMIT $1
  `, [limit]);

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

router.delete('/history/:id', async (req, res) => {
  const result = await pool.query(`DELETE FROM analyses WHERE id = $1`, [req.params.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Análisis no encontrado.' });
  res.json({ deleted: true });
});