import { pool, initSchema } from './database.js';

// Seeded RNG so the demo dataset is reproducible across reseeds
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2026);

function poissonSample(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

const LEAGUES = [
  {
    name: 'Liga Istmeña',
    country: 'Panamá',
    teams: [
      { name: 'Real Aurora FC', short: 'AUR', atk: 1.35, def: 0.75 },
      { name: 'Ciudad Norte', short: 'CNO', atk: 1.05, def: 0.95 },
      { name: 'Puerto Vega', short: 'PVG', atk: 0.80, def: 1.15 },
      { name: 'Atlético del Río', short: 'ADR', atk: 1.10, def: 1.00 },
      { name: 'Unión Chilibre', short: 'UCH', atk: 0.90, def: 1.05 },
      { name: 'Deportivo Bahía', short: 'DBA', atk: 1.15, def: 0.90 },
      { name: 'Sporting Colón', short: 'SCO', atk: 0.95, def: 1.10 },
      { name: 'Club Metropolitano', short: 'CME', atk: 1.20, def: 0.85 },
    ],
  },
  {
    name: 'Liga Central',
    country: 'Costa Rica',
    teams: [
      { name: 'Alajuela Unido', short: 'ALU', atk: 1.25, def: 0.85 },
      { name: 'Cartago FC', short: 'CTG', atk: 0.95, def: 1.00 },
      { name: 'Heredia Real', short: 'HRE', atk: 1.30, def: 0.80 },
      { name: 'Limón Costero', short: 'LMC', atk: 0.75, def: 1.20 },
      { name: 'Guanacaste SC', short: 'GNC', atk: 1.00, def: 1.00 },
      { name: 'Puntarenas United', short: 'PUN', atk: 0.85, def: 1.10 },
    ],
  },
  {
    name: 'Liga del Norte',
    country: 'México',
    teams: [
      { name: 'Monterrey Andino', short: 'MTA', atk: 1.40, def: 0.78 },
      { name: 'Saltillo FC', short: 'SAL', atk: 1.05, def: 0.98 },
      { name: 'Frontera Norte', short: 'FRN', atk: 0.88, def: 1.12 },
      { name: 'Torreón Real', short: 'TOR', atk: 1.12, def: 0.92 },
      { name: 'Chihuahua Sur', short: 'CHS', atk: 0.92, def: 1.08 },
      { name: 'Durango Athletic', short: 'DUR', atk: 1.02, def: 1.02 },
    ],
  },
];

const BASE_HOME_GOALS = 1.45;
const BASE_AWAY_GOALS = 1.10;
const TRUE_RHO = -0.09; // ground-truth dependence baked into the simulated results

function simulateGoals(homeAtk, homeDef, awayAtk, awayDef) {
  const lambdaHome = homeAtk * awayDef * BASE_HOME_GOALS;
  const lambdaAway = awayAtk * homeDef * BASE_AWAY_GOALS;
  let hg = poissonSample(lambdaHome);
  let ag = poissonSample(lambdaAway);
  // light nudge toward low-score dependence to mimic real Dixon-Coles structure
  if (hg <= 1 && ag <= 1 && rand() < Math.abs(TRUE_RHO)) {
    if (hg === 1 && ag === 1 && rand() < 0.5) ag = 0;
  }
  return { hg, ag };
}

function randomPastDate(daysBackMax) {
  const daysAgo = Math.floor(rand() * daysBackMax) + 1;
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function runSeed() {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM analyses; DELETE FROM matches; DELETE FROM teams; DELETE FROM leagues;');
    await client.query('BEGIN');

    for (const league of LEAGUES) {
      const { rows: [leagueRow] } = await client.query(
        `INSERT INTO leagues (name, country, rho) VALUES ($1, $2, -0.08) RETURNING id`,
        [league.name, league.country]
      );
      const leagueId = leagueRow.id;

      const teamIds = [];
      for (const t of league.teams) {
        const { rows: [teamRow] } = await client.query(
          `INSERT INTO teams (league_id, name, short_name) VALUES ($1, $2, $3) RETURNING id`,
          [leagueId, t.name, t.short]
        );
        teamIds.push(teamRow.id);
      }

      // Round-robin double (home & away) across ~3 pseudo-seasons for enough
      // sample size to make MLE rho estimation meaningful (matches dixonColes.js threshold of 10+)
      for (let season = 0; season < 3; season++) {
        for (let i = 0; i < league.teams.length; i++) {
          for (let j = 0; j < league.teams.length; j++) {
            if (i === j) continue;
            const home = league.teams[i];
            const away = league.teams[j];
            const { hg, ag } = simulateGoals(home.atk, home.def, away.atk, away.def);
            await client.query(`
              INSERT INTO matches (league_id, home_team_id, away_team_id, home_goals, away_goals, played_at)
              VALUES ($1, $2, $3, $4, $5, $6)
            `, [leagueId, teamIds[i], teamIds[j], hg, ag, randomPastDate(365 * (season + 1))]);
          }
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: counts } = await pool.query(`
    SELECT l.name, COUNT(m.id) as match_count, COUNT(DISTINCT t.id) as team_count
    FROM leagues l
    LEFT JOIN matches m ON m.league_id = l.id
    LEFT JOIN teams t ON t.league_id = l.id
    GROUP BY l.id
  `);

  console.log('Seed complete:');
  console.table(counts);
}

// Only seeds if the leagues table is empty -- safe to call on every server
// boot (e.g. Render deploys) without wiping real data once it exists.
export async function seedIfEmpty() {
  const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) as count FROM leagues`);
  if (Number(count) === 0) {
    console.log('No hay ligas en la base de datos, sembrando datos de ejemplo...');
    await runSeed();
  } else {
    console.log(`Base de datos ya tiene ${count} liga(s), omitiendo seed.`);
  }
}

// Allow running as a standalone script too: `node src/db/seed.js` force-reseeds.
const isMain = process.argv[1] && process.argv[1].endsWith('seed.js');
if (isMain) {
  (async () => {
    await initSchema();
    await runSeed();
    await pool.end();
  })();
}