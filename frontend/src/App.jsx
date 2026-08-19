import React, { useState, useEffect, useCallback } from 'react';
import { api } from './lib/api.js';
import './styles.css';

function toFairOdds(prob) {
  if (!prob || prob <= 0) return null;
  return 1 / prob;
}

function fmtOdds(prob) {
  const o = toFairOdds(prob);
  return o === null ? '—' : o.toFixed(2);
}

function marginOf(probs) {
  const sum = probs.reduce((s, p) => s + p, 0);
  return Math.abs(1 - sum) < 1e-9 ? 0 : (sum - 1) * 100;
}

function fmtKickoff(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('es-PA', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function OddsPill({ label, prob, highlight }) {
  return (
    <div className={`gm-pill ${highlight ? 'gm-pill--gold' : ''}`}>
      <span className="gm-pill-label">{label}</span>
      <span className="gm-pill-prob">{(prob * 100).toFixed(1)}%</span>
      <span className="gm-pill-odds">{fmtOdds(prob)}</span>
    </div>
  );
}

function MarginBadge({ probs }) {
  const margin = marginOf(probs);
  return (
    <div className="gm-margin-badge">
      <div className="gm-margin-dot" />
      <div>
        <div className="gm-margin-value">Margen: {margin.toFixed(2)}%</div>
        <div className="gm-margin-sub">Suma de probabilidades verificada</div>
      </div>
    </div>
  );
}

function FormResultDots({ results }) {
  const ordered = [...results].reverse();
  return (
    <div className="gm-form-dots">
      {ordered.map((r, i) => (
        <span
          key={i}
          className={`gm-form-dot gm-form-dot--${r.result.toLowerCase()}`}
          title={`${r.gf}-${r.ga} (${r.result === 'W' ? 'Victoria' : r.result === 'L' ? 'Derrota' : 'Empate'})`}
        >
          {r.result}
        </span>
      ))}
    </div>
  );
}

function TeamFormCard({ teamName, form }) {
  if (!form || form.played === 0) {
    return (
      <div className="gm-form-card">
        <div className="gm-form-card-head">{teamName}</div>
        <div className="gm-empty">Sin historial reciente disponible.</div>
      </div>
    );
  }

  return (
    <div className="gm-form-card">
      <div className="gm-form-card-head">
        {teamName}
        <span className="gm-form-card-sub">últimos {form.played} partidos</span>
      </div>

      <FormResultDots results={form.results} />

      <div className="gm-form-stats-grid">
        <div className="gm-form-stat">
          <span className="gm-form-stat-value">{form.avgGoalsFor.toFixed(2)}</span>
          <span className="gm-form-stat-label">goles a favor / partido</span>
        </div>
        <div className="gm-form-stat">
          <span className="gm-form-stat-value">{form.avgGoalsAgainst.toFixed(2)}</span>
          <span className="gm-form-stat-label">goles en contra / partido</span>
        </div>
        <div className="gm-form-stat">
          <span className="gm-form-stat-value">{(form.bttsPct * 100).toFixed(0)}%</span>
          <span className="gm-form-stat-label">BTTS ({form.bttsYes}/{form.played})</span>
        </div>
      </div>

      <div className="gm-form-ou-row">
        <div className="gm-form-ou-chip">
          <span className="gm-form-ou-label">Over 1.5</span>
          <span className="gm-form-ou-value">{(form.over15Pct * 100).toFixed(0)}%</span>
        </div>
        <div className="gm-form-ou-chip">
          <span className="gm-form-ou-label">Over 2.5</span>
          <span className="gm-form-ou-value">{(form.over25Pct * 100).toFixed(0)}%</span>
        </div>
        <div className="gm-form-ou-chip">
          <span className="gm-form-ou-label">Over 3.5</span>
          <span className="gm-form-ou-value">{(form.over35Pct * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function RecentFormSection({ homeTeam, awayTeam, homeForm, awayForm }) {
  return (
    <section className="gm-panel">
      <div className="gm-panel-head">
        <h2 className="gm-panel-title">Forma reciente</h2>
        <span className="gm-panel-note">Últimos 10 partidos en la liga · goles, BTTS y Over/Under</span>
      </div>
      <div className="gm-two-col">
        <TeamFormCard teamName={homeTeam.name} form={homeForm} />
        <TeamFormCard teamName={awayTeam.name} form={awayForm} />
      </div>
    </section>
  );
}

function ScoreHeatmap({ matrix, maxShow = 6 }) {
  let peak = 0;
  for (let h = 0; h <= maxShow; h++)
    for (let a = 0; a <= maxShow; a++)
      if (matrix[h][a] > peak) peak = matrix[h][a];

  const rows = [];
  for (let h = 0; h <= maxShow; h++) {
    const cells = [];
    for (let a = 0; a <= maxShow; a++) {
      const p = matrix[h][a];
      const intensity = peak > 0 ? p / peak : 0;
      cells.push(
        <div
          key={a}
          className="gm-heat-cell"
          style={{
            background: `rgba(23, 198, 135, ${0.08 + intensity * 0.55})`,
            color: intensity > 0.4 ? '#0D1310' : '#EDF2EE',
          }}
          title={`${h}-${a}: ${(p * 100).toFixed(2)}%`}
        >
          {(p * 100).toFixed(1)}
        </div>
      );
    }
    rows.push(
      <div className="gm-heat-row" key={h}>
        <div className="gm-heat-axis">{h}</div>
        {cells}
      </div>
    );
  }
  return (
    <div className="gm-heatmap">
      <div className="gm-heat-row gm-heat-row--header">
        <div className="gm-heat-axis" />
        {Array.from({ length: maxShow + 1 }).map((_, a) => (
          <div className="gm-heat-axis" key={a}>{a}</div>
        ))}
      </div>
      {rows}
    </div>
  );
}

function buildNarrative(homeTeam, awayTeam, lambdaHome, lambdaAway, markets, rho, sampleSize) {
  const favorite = markets.oneXTwo.home > markets.oneXTwo.away ? homeTeam : awayTeam;
  const favProb = Math.max(markets.oneXTwo.home, markets.oneXTwo.away);
  const goalTilt = lambdaHome + lambdaAway;
  const closeMatch = Math.abs(markets.oneXTwo.home - markets.oneXTwo.away) < 0.08;

  let text = `Con base en ${sampleSize} partidos históricos de la liga, el modelo proyecta ${lambdaHome.toFixed(2)} goles esperados para ${homeTeam} y ${lambdaAway.toFixed(2)} para ${awayTeam}. `;
  text += `El parámetro de dependencia Dixon-Coles (rho) fue calibrado automáticamente en ${rho.toFixed(3)} a partir del historial real de marcadores bajos de esta liga. `;

  if (closeMatch) {
    text += `Las probabilidades entre ambos equipos están muy parejas, sin favorito matemático claro. `;
  } else {
    text += `${favorite} aparece como favorito con ${(favProb * 100).toFixed(1)}% de probabilidad de victoria. `;
  }

  if (goalTilt > 3) {
    text += `La suma de goles esperados (${goalTilt.toFixed(2)}) sugiere tendencia ofensiva; Over 2.5 concentra ${(markets.overUnder['2.5'].over * 100).toFixed(1)}% de probabilidad. `;
  } else {
    text += `La suma de goles esperados (${goalTilt.toFixed(2)}) sugiere un partido más cerrado; Under 2.5 concentra ${(markets.overUnder['2.5'].under * 100).toFixed(1)}% de probabilidad. `;
  }

  text += `El marcador individual más probable es ${markets.topScores[0].h}-${markets.topScores[0].a} (${(markets.topScores[0].p * 100).toFixed(1)}%).`;

  return text;
}

function TeamLineupPanel({ label, team, boxScoreTeam }) {
  if (!team) return null;

  const statsByName = {};
  if (boxScoreTeam?.players) {
    for (const p of boxScoreTeam.players) {
      statsByName[p.name] = p.statistics?.[0] || {};
    }
  }

  const starters = (team.initialLineup || []).flat();

  return (
    <div className="gm-lineup-panel">
      <div className="gm-lineup-head">
        <span className="gm-lineup-label">{label}</span>
        <span className="gm-lineup-team-name">{team.name}</span>
        {team.formation && <span className="gm-lineup-formation">{team.formation}</span>}
      </div>
      <div className="gm-lineup-players">
        {starters.map((p, i) => {
          const stats = statsByName[p.name];
          return (
            <div key={i} className="gm-lineup-player">
              <span className="gm-lineup-player-number">{p.number ?? '—'}</span>
              <div className="gm-lineup-player-info">
                <span className="gm-lineup-player-name">{p.name}</span>
                <span className="gm-lineup-player-position">{p.position}</span>
              </div>
              {stats && (stats.shotsTotal != null) && (
                <span className="gm-lineup-player-stat" title="Tiros a puerta / Tiros totales">
                  {stats.shotsOnTarget ?? 0}/{stats.shotsTotal ?? 0} tiros
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineupsSection({ fixtureId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fixtureId) {
      setData(null);
      return;
    }
    setLoading(true);
    api.getFixturePlayers(fixtureId)
      .then(setData)
      .catch(() => setData({ available: false, reason: 'No se pudo cargar la información de jugadores.' }))
      .finally(() => setLoading(false));
  }, [fixtureId]);

  if (!fixtureId) return null;

  if (loading) {
    return (
      <section className="gm-panel">
        <div className="gm-panel-head"><h2 className="gm-panel-title">Alineaciones y estadísticas de jugadores</h2></div>
        <div className="gm-empty">Cargando alineaciones…</div>
      </section>
    );
  }

  if (!data || !data.available) {
    return (
      <section className="gm-panel">
        <div className="gm-panel-head"><h2 className="gm-panel-title">Alineaciones y estadísticas de jugadores</h2></div>
        <div className="gm-empty">
          {data?.reason || 'Alineaciones no disponibles todavía para este partido.'}
        </div>
      </section>
    );
  }

  const homeBoxScore = data.boxScore?.find(t => t.team?.name === data.lineups.homeTeam?.name);
  const awayBoxScore = data.boxScore?.find(t => t.team?.name === data.lineups.awayTeam?.name);

  return (
    <section className="gm-panel">
      <div className="gm-panel-head">
        <h2 className="gm-panel-title">Alineaciones y estadísticas de jugadores</h2>
        <span className="gm-panel-note">Datos en vivo de Highlightly</span>
      </div>
      <div className="gm-lineups-grid">
        <TeamLineupPanel label="Local" team={data.lineups.homeTeam} boxScoreTeam={homeBoxScore} />
        <TeamLineupPanel label="Visitante" team={data.lineups.awayTeam} boxScoreTeam={awayBoxScore} />
      </div>
    </section>
  );
}

// UEFA competition slots and relegation zones per league (5 major European
// leagues, 2026-27 season allocation). Bundesliga has 18 teams, the rest 20.
function getZone(leagueName, position, totalTeams) {
  const zones = {
    'Premier League': { cl: 5, el: 6, ecl: 6, releg: 3 },
    'La Liga': { cl: 4, el: 5, ecl: 6, releg: 3 },
    'Bundesliga': { cl: 4, el: 5, ecl: 6, releg: 2 },
    'Serie A': { cl: 4, el: 5, ecl: 6, releg: 3 },
    'Ligue 1': { cl: 3, el: 4, ecl: 5, releg: 3 },
    'Eredivisie': { cl: 2, el: 3, ecl: 4, releg: 2 },
    'Primeira Liga': { cl: 2, el: 3, ecl: 4, releg: 3 },
    'Championship': { cl: 0, el: 0, ecl: 0, releg: 3 },
    'Brasileirão': { cl: 0, el: 0, ecl: 0, releg: 4 },
  };
  const z = zones[leagueName];
  if (!z) return null;

  if (z.cl && position <= z.cl) return 'cl';
  if (z.el && position <= z.el) return 'el';
  if (z.ecl && position <= z.ecl) return 'ecl';
  if (position > totalTeams - z.releg) return 'releg';
  return null;
}

function StandingsSection({ leagues, leagueId, setLeagueId }) {
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    setError(null);
    api.getStandings(leagueId)
      .then(setStandings)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [leagueId]);

  return (
    <section className="gm-panel">
      <div className="gm-panel-head">
        <h2 className="gm-panel-title">Tabla de posiciones</h2>
        <select className="gm-select gm-select--inline" value={leagueId ?? ''} onChange={e => setLeagueId(Number(e.target.value))}>
          {leagues.map(l => (
            <option key={l.id} value={l.id}>{l.name} ({l.country})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="gm-empty">Cargando tabla…</div>
      ) : error ? (
        <div className="gm-empty">{error}</div>
      ) : standings.length === 0 ? (
        <div className="gm-empty">No hay partidos suficientes para calcular la tabla de esta liga.</div>
      ) : (
        <>
          <div className="gm-standings-table-wrap">
            <table className="gm-standings-table">
              <thead>
                <tr>
                  <th className="gm-standings-th gm-standings-th--pos">#</th>
                  <th className="gm-standings-th gm-standings-th--team">Equipo</th>
                  <th className="gm-standings-th">PJ</th>
                  <th className="gm-standings-th">G</th>
                  <th className="gm-standings-th">E</th>
                  <th className="gm-standings-th">P</th>
                  <th className="gm-standings-th">GF</th>
                  <th className="gm-standings-th">GC</th>
                  <th className="gm-standings-th">DG</th>
                  <th className="gm-standings-th gm-standings-th--pts">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map(t => {
                  const currentLeague = leagues.find(l => l.id === leagueId);
                  const zone = currentLeague ? getZone(currentLeague.name, t.position, standings.length) : null;
                  return (
                    <tr key={t.id} className={zone ? `gm-standings-row--${zone}` : ''}>
                      <td className="gm-standings-td gm-standings-td--pos">
                        <span className={`gm-zone-dot ${zone ? `gm-zone-dot--${zone}` : 'gm-zone-dot--none'}`} />
                        {t.position}
                      </td>
                      <td className="gm-standings-td gm-standings-td--team">{t.name}</td>
                      <td className="gm-standings-td">{t.played}</td>
                      <td className="gm-standings-td">{t.won}</td>
                      <td className="gm-standings-td">{t.drawn}</td>
                      <td className="gm-standings-td">{t.lost}</td>
                      <td className="gm-standings-td">{t.goalsFor}</td>
                      <td className="gm-standings-td">{t.goalsAgainst}</td>
                      <td className="gm-standings-td">{t.goalDiff > 0 ? `+${t.goalDiff}` : t.goalDiff}</td>
                      <td className="gm-standings-td gm-standings-td--pts">{t.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="gm-standings-legend">
            <span className="gm-standings-legend-item"><span className="gm-zone-dot gm-zone-dot--cl" /> Champions League</span>
            <span className="gm-standings-legend-item"><span className="gm-zone-dot gm-zone-dot--el" /> Europa League</span>
            <span className="gm-standings-legend-item"><span className="gm-zone-dot gm-zone-dot--ecl" /> Conference League</span>
            <span className="gm-standings-legend-item"><span className="gm-zone-dot gm-zone-dot--releg" /> Descenso</span>
          </div>
        </>
      )}
    </section>
  );
}

export default function App() {
  const [view, setView] = useState('analyze');
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(null);
  const [teams, setTeams] = useState([]);
  const [homeTeamId, setHomeTeamId] = useState(null);
  const [awayTeamId, setAwayTeamId] = useState(null);

  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [fixtures, setFixtures] = useState([]);
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [activeFixtureId, setActiveFixtureId] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    api.getLeagues()
      .then(ls => {
        setLeagues(ls);
        if (ls.length > 0) setLeagueId(ls[0].id);
      })
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!leagueId) return;
    api.getTeams(leagueId)
      .then(ts => {
        setTeams(ts);
        setHomeTeamId(ts[0]?.id ?? null);
        setAwayTeamId(ts[1]?.id ?? null);
        setAnalysis(null);
        setActiveFixtureId(null);
      })
      .catch(e => setError(e.message));

    setFixturesLoading(true);
    api.getFixtures(leagueId)
      .then(setFixtures)
      .catch(e => setError(e.message))
      .finally(() => setFixturesLoading(false));
  }, [leagueId]);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    api.getHistory(20)
      .then(setHistory)
      .catch(e => setError(e.message))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view, loadHistory]);

  const runAnalysis = async (fixtureIdOverride) => {
    const fxId = fixtureIdOverride !== undefined ? fixtureIdOverride : activeFixtureId;
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.analyze(leagueId, homeTeamId, awayTeamId, fxId);
      setAnalysis(result);
    } catch (e) {
      setError(e.message);
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  };

  const selectFixture = (fixture) => {
    setHomeTeamId(fixture.home_team_id);
    setAwayTeamId(fixture.away_team_id);
    setActiveFixtureId(fixture.id);
    setAnalysis(null);
  };

  const swapTeams = () => {
    setHomeTeamId(awayTeamId);
    setAwayTeamId(homeTeamId);
    setActiveFixtureId(null);
  };

  const deleteHistoryItem = async (id) => {
    try {
      await api.deleteHistory(id);
      setHistory(prev => prev.filter(h => h.id !== id));
    } catch (e) {
      setError(e.message);
    }
  };

  const currentLeague = leagues.find(l => l.id === leagueId);

  return (
    <div className="gm-root">
      <header className="gm-header">
        <div className="gm-header-inner">
          <nav className="gm-nav">
            <button className={`gm-nav-link ${view === 'analyze' ? 'gm-nav-link--active' : ''}`} onClick={() => setView('analyze')}>
              Analizar
            </button>
            <button className={`gm-nav-link ${view === 'history' ? 'gm-nav-link--active' : ''}`} onClick={() => setView('history')}>
              Historial
            </button>
            <button className={`gm-nav-link ${view === 'standings' ? 'gm-nav-link--active' : ''}`} onClick={() => setView('standings')}>
              Tabla
            </button>
          </nav>
        </div>
      </header>

      <main className="gm-main">
        {error && (
          <div className="gm-error-banner">
            {error}
            <button className="gm-error-close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {view === 'analyze' && (
          <>
            <section className="gm-hero">
              <div className="gm-hero-brand">
                <img src="/logo.png" alt="Greenmoney" className="gm-hero-logo" />
                <span className="gm-hero-brand-text">Green Money</span>
              </div>
              <div className="gm-hero-eyebrow">Motor Dixon-Coles · Calibración automática por liga</div>
              <h1 className="gm-hero-title">
                El valor matemático real de cada partido, sin margen oculto.
              </h1>
              <p className="gm-hero-sub">
                Greenmoney calcula probabilidades a partir del historial real de goles de cada equipo
                en su base de datos, estima el parámetro de dependencia por máxima verosimilitud, y
                convierte todo en cuotas justas. Sin overround. 100% de la probabilidad, sin margen de casa.
              </p>
            </section>

            <section className="gm-panel gm-fixtures-panel">
              <div className="gm-panel-head">
                <h2 className="gm-panel-title">Próximos partidos programados</h2>
                <span className="gm-panel-note">Datos reales de la liga seleccionada</span>
              </div>
              {fixturesLoading ? (
                <div className="gm-empty">Cargando calendario…</div>
              ) : fixtures.length === 0 ? (
                <div className="gm-empty">
                  No hay partidos programados cargados para esta liga todavía. Puedes seguir usando
                  el análisis libre más abajo entre cualquier par de equipos.
                </div>
              ) : (
                <div className="gm-fixtures-list">
                  {fixtures.slice(0, 8).map(f => (
                    <button
                      key={f.id}
                      className={`gm-fixture-row ${activeFixtureId === f.id ? 'gm-fixture-row--active' : ''}`}
                      onClick={() => selectFixture(f)}
                    >
                      <span className="gm-fixture-date">{fmtKickoff(f.kickoff_at)}</span>
                      <span className="gm-fixture-teams">{f.home_team_name} <span className="gm-fixture-vs">vs</span> {f.away_team_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="gm-selector-card">
              <div className="gm-selector-grid gm-selector-grid--with-league">
                <div className="gm-selector-field">
                  <label className="gm-label">Liga</label>
                  <select className="gm-select" value={leagueId ?? ''} onChange={e => setLeagueId(Number(e.target.value))}>
                    {leagues.map(l => (
                      <option key={l.id} value={l.id}>{l.name} ({l.country})</option>
                    ))}
                  </select>
                </div>
                <div />
                <div />
                <div />
              </div>

              <div className="gm-selector-grid" style={{ marginTop: 14 }}>
                <div className="gm-selector-field">
                  <label className="gm-label">Equipo local</label>
                  <select className="gm-select" value={homeTeamId ?? ''} onChange={e => { setHomeTeamId(Number(e.target.value)); setActiveFixtureId(null); }}>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <button className="gm-swap-btn" onClick={swapTeams} aria-label="Intercambiar equipos" title="Intercambiar">⇄</button>

                <div className="gm-selector-field">
                  <label className="gm-label">Equipo visitante</label>
                  <select className="gm-select" value={awayTeamId ?? ''} onChange={e => { setAwayTeamId(Number(e.target.value)); setActiveFixtureId(null); }}>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <button className="gm-analyze-btn" onClick={() => runAnalysis()} disabled={loading || homeTeamId === awayTeamId}>
                  {loading ? 'Calculando…' : 'Generar análisis'}
                </button>
              </div>

              {homeTeamId === awayTeamId && (
                <div className="gm-warning">Elige dos equipos distintos para analizar el enfrentamiento.</div>
              )}

              {currentLeague && currentLeague.rho_updated_at && (
                <div className="gm-rho-note">
                  rho calibrado para {currentLeague.name}: <strong>{currentLeague.rho.toFixed(3)}</strong> (última actualización: {currentLeague.rho_updated_at})
                </div>
              )}

              {analysis && (
                <div className="gm-lambda-row">
                  <div className="gm-lambda-chip">
                    <span className="gm-lambda-team">{analysis.homeTeam.name}</span>
                    <span className="gm-lambda-value">λ {analysis.lambdaHome.toFixed(2)}</span>
                    <span className="gm-lambda-tag">goles esperados</span>
                  </div>
                  <div className="gm-lambda-vs">vs</div>
                  <div className="gm-lambda-chip">
                    <span className="gm-lambda-team">{analysis.awayTeam.name}</span>
                    <span className="gm-lambda-value">λ {analysis.lambdaAway.toFixed(2)}</span>
                    <span className="gm-lambda-tag">goles esperados</span>
                  </div>
                </div>
              )}

              {analysis?.kickoffAt && (
                <div className="gm-fixture-badge">
                  📅 Partido real programado: {fmtKickoff(analysis.kickoffAt)}
                </div>
              )}
            </section>

            <LineupsSection fixtureId={activeFixtureId} />

            {!analysis && !loading && (
              <div className="gm-empty-hint">
                Elige liga y equipos, luego presiona <strong>Generar análisis</strong> para ver probabilidades y cuotas justas.
              </div>
            )}

            {analysis && (
              <>
                <section className="gm-panel">
                  <div className="gm-panel-head">
                    <h2 className="gm-panel-title">Resultado 1X2</h2>
                    <MarginBadge probs={[analysis.markets.oneXTwo.home, analysis.markets.oneXTwo.draw, analysis.markets.oneXTwo.away]} />
                  </div>
                  <div className="gm-pill-row">
                    <OddsPill label={`Gana ${analysis.homeTeam.name}`} prob={analysis.markets.oneXTwo.home} highlight={analysis.markets.oneXTwo.home === Math.max(analysis.markets.oneXTwo.home, analysis.markets.oneXTwo.draw, analysis.markets.oneXTwo.away)} />
                    <OddsPill label="Empate" prob={analysis.markets.oneXTwo.draw} highlight={analysis.markets.oneXTwo.draw === Math.max(analysis.markets.oneXTwo.home, analysis.markets.oneXTwo.draw, analysis.markets.oneXTwo.away)} />
                    <OddsPill label={`Gana ${analysis.awayTeam.name}`} prob={analysis.markets.oneXTwo.away} highlight={analysis.markets.oneXTwo.away === Math.max(analysis.markets.oneXTwo.home, analysis.markets.oneXTwo.draw, analysis.markets.oneXTwo.away)} />
                  </div>
                </section>

                <RecentFormSection
                  homeTeam={analysis.homeTeam}
                  awayTeam={analysis.awayTeam}
                  homeForm={analysis.homeForm}
                  awayForm={analysis.awayForm}
                />

                <div className="gm-two-col">
                  <section className="gm-panel">
                    <div className="gm-panel-head"><h2 className="gm-panel-title">Total de goles</h2></div>
                    {[1.5, 2.5, 3.5].map(line => (
                      <div key={line} className="gm-ou-block">
                        <div className="gm-ou-line">Línea {line}</div>
                        <div className="gm-pill-row gm-pill-row--compact">
                          <OddsPill label={`Over ${line}`} prob={analysis.markets.overUnder[line].over} />
                          <OddsPill label={`Under ${line}`} prob={analysis.markets.overUnder[line].under} />
                        </div>
                        <MarginBadge probs={[analysis.markets.overUnder[line].over, analysis.markets.overUnder[line].under]} />
                      </div>
                    ))}
                  </section>

                  <section className="gm-panel">
                    <div className="gm-panel-head"><h2 className="gm-panel-title">Ambos anotan (BTTS)</h2></div>
                    <div className="gm-pill-row">
                      <OddsPill label="Sí" prob={analysis.markets.btts.yes} highlight={analysis.markets.btts.yes > analysis.markets.btts.no} />
                      <OddsPill label="No" prob={analysis.markets.btts.no} highlight={analysis.markets.btts.no > analysis.markets.btts.yes} />
                    </div>
                    <MarginBadge probs={[analysis.markets.btts.yes, analysis.markets.btts.no]} />

                    <div className="gm-panel-head gm-panel-head--sub">
                      <h3 className="gm-panel-subtitle">Marcadores más probables</h3>
                    </div>
                    <div className="gm-score-list">
                      {analysis.markets.topScores.slice(0, 5).map((s, i) => (
                        <div key={i} className="gm-score-row">
                          <span className="gm-score-result">{s.h} – {s.a}</span>
                          <span className="gm-score-bar-track">
                            <span className="gm-score-bar-fill" style={{ width: `${(s.p / analysis.markets.topScores[0].p) * 100}%` }} />
                          </span>
                          <span className="gm-score-prob">{(s.p * 100).toFixed(1)}%</span>
                          <span className="gm-score-odds">{fmtOdds(s.p)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="gm-panel">
                  <div className="gm-panel-head">
                    <h2 className="gm-panel-title">Matriz de distribución de marcadores</h2>
                    <span className="gm-panel-note">Probabilidad (%) por combinación de goles, 0–6</span>
                  </div>
                  <ScoreHeatmap matrix={analysis.matrix} />
                </section>

                <section className="gm-panel gm-panel--narrative">
                  <div className="gm-panel-head"><h2 className="gm-panel-title">Lectura del modelo</h2></div>
                  <p className="gm-narrative-text">
                    {buildNarrative(
                      analysis.homeTeam.name,
                      analysis.awayTeam.name,
                      analysis.lambdaHome,
                      analysis.lambdaAway,
                      analysis.markets,
                      analysis.rho,
                      analysis.sampleSize
                    )}
                  </p>
                </section>
              </>
            )}
          </>
        )}

        {view === 'history' && (
          <section className="gm-panel">
            <div className="gm-panel-head"><h2 className="gm-panel-title">Análisis guardados</h2></div>
            {historyLoading ? (
              <div className="gm-empty">Cargando historial…</div>
            ) : history.length === 0 ? (
              <div className="gm-empty">
                Todavía no hay análisis guardados. Ve a <strong>Analizar</strong>, genera uno y aparecerá aquí.
              </div>
            ) : (
              <div className="gm-history-list">
                {history.map(h => (
                  <div key={h.id} className="gm-history-row">
                    <div className="gm-history-main">
                      <div className="gm-history-league">{h.leagueName}</div>
                      <div className="gm-history-teams">{h.homeTeam} <span className="gm-history-vs">vs</span> {h.awayTeam}</div>
                      <div className="gm-history-time">{h.createdAt} · rho {h.rho.toFixed(3)}</div>
                    </div>
                    <div className="gm-history-odds">
                      <span>1: {fmtOdds(h.oneXTwo.home)}</span>
                      <span>X: {fmtOdds(h.oneXTwo.draw)}</span>
                      <span>2: {fmtOdds(h.oneXTwo.away)}</span>
                    </div>
                    <button className="gm-history-delete" onClick={() => deleteHistoryItem(h.id)} aria-label="Eliminar">×</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'standings' && (
          <StandingsSection leagues={leagues} leagueId={leagueId} setLeagueId={setLeagueId} />
        )}
      </main>

      <footer className="gm-footer">
        <p>
          Greenmoney es una herramienta de análisis estadístico y entretenimiento. No opera apuestas
          y no garantiza resultados deportivos. Datos de liga de demostración.
        </p>
      </footer>
    </div>
  );
}