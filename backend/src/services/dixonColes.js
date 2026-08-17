// ============================================================
// Dixon-Coles fair-odds engine
// ------------------------------------------------------------
// Pipeline: team attack/defense strengths -> expected goals (lambda)
// -> Poisson scoreline matrix -> Dixon-Coles low-score correction
// -> normalize to sum = 1.0 -> markets -> fair odds (1/prob)
// ============================================================

const MAX_GOALS = 10;

function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonProb(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

// Dixon-Coles tau correction for low-scoring dependence (0-0, 1-0, 0-1, 1-1)
export function dixonColesTau(x, y, lambdaHome, lambdaAway, rho) {
  if (x === 0 && y === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (x === 0 && y === 1) return 1 + lambdaHome * rho;
  if (x === 1 && y === 0) return 1 + lambdaAway * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Compute attack/defense strength ratings for every team in a league from
 * their match history, relative to league-average home/away scoring.
 * Returns a map: teamId -> { homeAttack, homeDefense, awayAttack, awayDefense }
 */
export function computeTeamStrengths(matches, teamIds) {
  const homeGoalsFor = {}, homeGoalsAgainst = {}, homePlayed = {};
  const awayGoalsFor = {}, awayGoalsAgainst = {}, awayPlayed = {};

  teamIds.forEach(id => {
    homeGoalsFor[id] = 0; homeGoalsAgainst[id] = 0; homePlayed[id] = 0;
    awayGoalsFor[id] = 0; awayGoalsAgainst[id] = 0; awayPlayed[id] = 0;
  });

  let totalHomeGoals = 0, totalAwayGoals = 0, totalMatches = 0;

  for (const m of matches) {
    homeGoalsFor[m.home_team_id] += m.home_goals;
    homeGoalsAgainst[m.home_team_id] += m.away_goals;
    homePlayed[m.home_team_id] += 1;

    awayGoalsFor[m.away_team_id] += m.away_goals;
    awayGoalsAgainst[m.away_team_id] += m.home_goals;
    awayPlayed[m.away_team_id] += 1;

    totalHomeGoals += m.home_goals;
    totalAwayGoals += m.away_goals;
    totalMatches += 1;
  }

  const leagueAvgHomeGF = totalMatches > 0 ? totalHomeGoals / totalMatches : 1.4;
  const leagueAvgAwayGF = totalMatches > 0 ? totalAwayGoals / totalMatches : 1.1;

  const strengths = {};
  for (const id of teamIds) {
    const hp = homePlayed[id] || 1;
    const ap = awayPlayed[id] || 1;
    strengths[id] = {
      homeAttack: (homeGoalsFor[id] / hp) / leagueAvgHomeGF,
      homeDefense: (homeGoalsAgainst[id] / hp) / leagueAvgAwayGF,
      awayAttack: (awayGoalsFor[id] / ap) / leagueAvgAwayGF,
      awayDefense: (awayGoalsAgainst[id] / ap) / leagueAvgHomeGF,
      homePlayed: homePlayed[id],
      awayPlayed: awayPlayed[id],
    };
  }

  return { strengths, leagueAvgHomeGF, leagueAvgAwayGF };
}

export function expectedGoals(homeTeamId, awayTeamId, strengthData) {
  const { strengths, leagueAvgHomeGF, leagueAvgAwayGF } = strengthData;
  const h = strengths[homeTeamId];
  const a = strengths[awayTeamId];
  const lambdaHome = h.homeAttack * a.awayDefense * leagueAvgHomeGF;
  const lambdaAway = a.awayAttack * h.homeDefense * leagueAvgAwayGF;
  return { lambdaHome, lambdaAway };
}

/**
 * Estimate rho via maximum likelihood on the league's match history.
 * For each historical match we know the actual home/away teams' strengths
 * (computed once from the full dataset) and the actual scoreline. We search
 * rho in a bounded range to maximize the log-likelihood of observed
 * scorelines under the Dixon-Coles-adjusted Poisson model.
 *
 * This is a simplified, single-pass MLE (grid + refine), sufficient for a
 * per-league correction parameter without a full iterative solver.
 */
export function estimateRho(matches, strengthData) {
  if (matches.length < 10) return -0.08; // not enough data, fall back to literature default

  function logLikelihood(rho) {
    let ll = 0;
    for (const m of matches) {
      const { lambdaHome, lambdaAway } = expectedGoals(m.home_team_id, m.away_team_id, strengthData);
      const pBase = poissonProb(m.home_goals, lambdaHome) * poissonProb(m.away_goals, lambdaAway);
      const tau = dixonColesTau(m.home_goals, m.away_goals, lambdaHome, lambdaAway, rho);
      const p = Math.max(pBase * tau, 1e-10); // avoid log(0)
      ll += Math.log(p);
    }
    return ll;
  }

  // Coarse grid search over the theoretically sane range for rho, then refine.
  let bestRho = -0.08;
  let bestLL = -Infinity;
  for (let r = -0.3; r <= 0.3; r += 0.01) {
    const ll = logLikelihood(r);
    if (ll > bestLL) { bestLL = ll; bestRho = r; }
  }
  // Refine around the best coarse value
  for (let r = bestRho - 0.01; r <= bestRho + 0.01; r += 0.001) {
    const ll = logLikelihood(r);
    if (ll > bestLL) { bestLL = ll; bestRho = r; }
  }

  return Math.round(bestRho * 1000) / 1000;
}

export function buildScoreMatrix(lambdaHome, lambdaAway, rho) {
  const raw = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    const row = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const base = poissonProb(h, lambdaHome) * poissonProb(a, lambdaAway);
      const tau = dixonColesTau(h, a, lambdaHome, lambdaAway, rho);
      const p = Math.max(base * tau, 0);
      row.push(p);
      total += p;
    }
    raw.push(row);
  }
  // Normalize so the matrix sums to exactly 1.0 -- zero overround by construction
  return raw.map(row => row.map(p => (total > 0 ? p / total : 0)));
}

export function toFairOdds(prob) {
  if (prob <= 0) return null; // represented as null -> displayed as "—"
  return 1 / prob;
}

export function computeMarkets(matrix) {
  let pHome = 0, pDraw = 0, pAway = 0;
  const overUnder = { 1.5: { over: 0, under: 0 }, 2.5: { over: 0, under: 0 }, 3.5: { over: 0, under: 0 } };
  let btts = { yes: 0, no: 0 };
  let exactScores = [];

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a];
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;

      const totalGoals = h + a;
      [1.5, 2.5, 3.5].forEach(line => {
        if (totalGoals > line) overUnder[line].over += p;
        else overUnder[line].under += p;
      });

      if (h > 0 && a > 0) btts.yes += p;
      else btts.no += p;

      exactScores.push({ h, a, p });
    }
  }

  exactScores.sort((x, y) => y.p - x.p);

  return {
    oneXTwo: { home: pHome, draw: pDraw, away: pAway },
    overUnder,
    btts,
    topScores: exactScores.slice(0, 8),
  };
}

// Verify a market's probabilities sum to 1.0 -- proof of 0% overround
export function marginCheck(probs) {
  const sumImplied = probs.reduce((s, p) => s + p, 0);
  return Math.abs(1 - sumImplied) < 1e-9 ? 0 : (sumImplied - 1) * 100;
}

export function runFullAnalysis(homeTeamId, awayTeamId, matches, teamIds) {
  const strengthData = computeTeamStrengths(matches, teamIds);
  const rho = estimateRho(matches, strengthData);
  const { lambdaHome, lambdaAway } = expectedGoals(homeTeamId, awayTeamId, strengthData);
  const matrix = buildScoreMatrix(lambdaHome, lambdaAway, rho);
  const markets = computeMarkets(matrix);

  return {
    lambdaHome,
    lambdaAway,
    rho,
    matrix,
    markets,
    leagueAvgHomeGF: strengthData.leagueAvgHomeGF,
    leagueAvgAwayGF: strengthData.leagueAvgAwayGF,
    sampleSize: matches.length,
  };
}
